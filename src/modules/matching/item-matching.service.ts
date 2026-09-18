import { Injectable, Logger } from '@nestjs/common';
import { ErpNextService } from '../purchasing-erpnext/erpnext.service';
import { ExtractedItem, ItemMatchResult } from '../../common/interfaces/invoice-schema.interface';
import { ErpItem } from '../../database/entities/erp-item.entity';

@Injectable()
export class ItemMatchingService {
  private readonly logger = new Logger(ItemMatchingService.name);

  constructor(private readonly erpNextService: ErpNextService) {}

  async matchItem(item: ExtractedItem): Promise<ItemMatchResult> {
    const items = await this.erpNextService.getAllItems();
    const rawCode = (item.item_code || '').trim().toUpperCase();
    const rawDesc = (item.description || '').trim();
    const normDesc = this.normalizeItemText(rawDesc);

    const rawHsn = (item.hsn_code || '').trim();

    // 1. Direct Item Code Match (100% confidence)
    if (rawCode) {
      const codeMatch = items.find(
        (i) => (i.item_code && i.item_code.toUpperCase() === rawCode) ||
               (i.supplier_part_no && i.supplier_part_no.toUpperCase() === rawCode) ||
               (i.barcode && i.barcode.toUpperCase() === rawCode)
      );
      if (codeMatch) {
        return {
          item_code: codeMatch.item_code,
          item_name: codeMatch.item_name,
          uom: codeMatch.stock_uom,
          confidence: 1.0,
          match_reason: `Exact Item Code match (${codeMatch.item_code})`,
          match_type: 'EXACT_CODE',
        };
      }
    }

    // 2. Embedded SKU / Item Code in Description (e.g. "C6-PJRZ-EBD0 - Description" or "B0H5Q748SW ...")
    const codePrefixMatch = rawDesc.match(/^([A-Z0-9_\-\/]{3,30})\s*[-–:|]\s*(.+)$/i);
    if (codePrefixMatch) {
      const candidateCode = codePrefixMatch[1].trim().toUpperCase();
      const codeMatch = items.find(
        (i) => (i.item_code && i.item_code.toUpperCase() === candidateCode) ||
               (i.supplier_part_no && i.supplier_part_no.toUpperCase() === candidateCode) ||
               (i.barcode && i.barcode.toUpperCase() === candidateCode)
      );
      if (codeMatch) {
        return {
          item_code: codeMatch.item_code,
          item_name: codeMatch.item_name,
          uom: codeMatch.stock_uom,
          confidence: 1.0,
          match_reason: `Exact Embedded SKU Code (${candidateCode}) match with ERP Item`,
          match_type: 'EXACT_CODE',
        };
      }
    }

    // 3. Title (Item Name/Description) AND HSN Code Match (100% confidence)
    if (rawDesc) {
      const cleanDesc = codePrefixMatch ? codePrefixMatch[2].trim() : rawDesc;
      const cleanNormDesc = this.normalizeItemText(cleanDesc);

      const titleAndHsnMatch = items.find((i) => {
        const titleEquals = i.item_name.toLowerCase() === rawDesc.toLowerCase() ||
                            this.normalizeItemText(i.item_name) === normDesc ||
                            i.item_name.toLowerCase() === cleanDesc.toLowerCase() ||
                            this.normalizeItemText(i.item_name) === cleanNormDesc;
        const hsnEquals = rawHsn && i.gst_hsn_code && i.gst_hsn_code.trim().startsWith(rawHsn.substring(0, 4));
        return titleEquals && hsnEquals;
      });

      if (titleAndHsnMatch) {
        return {
          item_code: titleAndHsnMatch.item_code,
          item_name: titleAndHsnMatch.item_name,
          uom: titleAndHsnMatch.stock_uom,
          confidence: 1.0,
          match_reason: `Exact Title & GST HSN Code (${rawHsn}) match with ERP Item`,
          match_type: 'TITLE_AND_HSN',
        };
      }
    }

    // 4. Exact Item Name Match (Links to ERP item; notes HSN difference if any)
    const cleanDesc = codePrefixMatch ? codePrefixMatch[2].trim() : rawDesc;
    const cleanNormDesc = this.normalizeItemText(cleanDesc);
    const strippedDesc = cleanDesc
      .replace(/\r?\n\s*(?:SKU|Item Code|Model|Material|Grid|Size|Color|Finish|Brand|Made in|Dimensions?):.+$/is, '')
      .replace(/\s*\|\s*(?:SKU|Item Code|Model|Material|Grid|Size|Color|Finish|Brand|Made in|Dimensions?):.+$/i, '')
      .trim();
    const strippedNormDesc = this.normalizeItemText(strippedDesc);

    const exactNameMatch = items.find(
      (i) => i.item_name.toLowerCase() === rawDesc.toLowerCase() ||
             this.normalizeItemText(i.item_name) === normDesc ||
             i.item_name.toLowerCase() === cleanDesc.toLowerCase() ||
             this.normalizeItemText(i.item_name) === cleanNormDesc ||
             i.item_name.toLowerCase() === strippedDesc.toLowerCase() ||
             this.normalizeItemText(i.item_name) === strippedNormDesc
    );
    if (exactNameMatch) {
      const erpHsn = (exactNameMatch.gst_hsn_code || '').trim();
      const hsnMatches = rawHsn && erpHsn ? rawHsn.substring(0, 4) === erpHsn.substring(0, 4) : true;
      const matchReason = rawHsn && erpHsn && !hsnMatches
        ? `Exact Title match, but HSN differs (Invoice: ${rawHsn} vs ERP: ${erpHsn}). Please review.`
        : (rawHsn && erpHsn ? `Exact Title & Verified HSN (${rawHsn}) with ERP Item` : 'Exact Item Title match');

      return {
        item_code: exactNameMatch.item_code,
        item_name: exactNameMatch.item_name,
        uom: exactNameMatch.stock_uom,
        confidence: hsnMatches ? 0.98 : 0.90,
        match_reason: matchReason,
        match_type: hsnMatches && rawHsn ? 'TITLE_AND_HSN' : 'EXACT_NAME',
      };
    }

    // 5. If not an exact match (Code, Embedded SKU, or Title), do NOT auto-assign item_code.
    // Leave it as unlinked (New Custom Item) so user can choose from suggestions or create new.
    const query = cleanDesc || rawDesc || rawCode;
    const candidates = items
      .map((i) => ({
        item_code: i.item_code,
        item_name: i.item_name,
        confidence: Number(this.computeAdvancedSimilarity(query, i).toFixed(2)),
      }))
      .filter((c) => c.confidence > 0.15);

    return {
      item_code: null,
      item_name: null,
      confidence: 0,
      match_reason: 'Item is not an exact match in ERPNext. Marked as new item for review.',
      match_type: 'NONE',
      candidates: candidates.sort((a, b) => b.confidence - a.confidence).slice(0, 5),
    };
  }

  private computeAdvancedSimilarity(query: string, item: ErpItem): number {
    if (!query) return 0;
    const q = query.toLowerCase().trim();
    const rawCode = (item.item_code || '').toLowerCase();
    const rawName = (item.item_name || '').toLowerCase();
    const rawDesc = (item.description || '').toLowerCase();

    if (rawCode === q || rawName === q) return 1.0;
    if (rawCode.replace(/[-_]/g, ' ') === q.replace(/[-_]/g, ' ')) return 0.98;
    if (rawName.replace(/[-_]/g, ' ') === q.replace(/[-_]/g, ' ')) return 0.98;

    const qNorm = this.normalizeItemText(query);
    const itNorm = this.normalizeItemText(rawCode + ' ' + rawName + ' ' + rawDesc);

    if (qNorm === itNorm) return 0.99;

    const qTokens = qNorm.split(' ').filter(Boolean);
    const itTokens = new Set(itNorm.split(' ').filter(Boolean));
    const itText = itNorm;

    if (qTokens.length === 0) return 0;

    const colorList = ['black', 'white', 'red', 'green', 'blue', 'yellow', 'maroon', 'navyblue', 'lightgray', 'gray', 'grey', 'gold', 'antique', 'silver', 'brown', 'natural', 'walnut', 'oak', 'teak'];
    const sizeList = ['xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl', '2xl', '3xl', '4in', '6in', '8in', '10in', '12in', '14in', '16in', '18in', '24in'];
    const coreNounList = ['tshirt', 'hoodie', 'shirt', 'jacket', 'pant', 'ganesha', 'idol', 'stand', 'clock', 'coaster', 'shelf', 'holder', 'box', 'tray', 'bottle', 'pen', 'calendar', 'laptop', 'pack', 'sign'];

    const qColors = qTokens.filter((t) => colorList.includes(t));
    const qSizes = qTokens.filter((t) => sizeList.includes(t));
    const qNouns = qTokens.filter((t) => coreNounList.includes(t));
    const qGeneral = qTokens.filter((t) => !colorList.includes(t) && !sizeList.includes(t) && !coreNounList.includes(t));

    // If query has core product noun, candidate MUST match it
    if (qNouns.length > 0) {
      const nounMatched = qNouns.some((n) => itTokens.has(n) || itText.includes(n));
      if (!nounMatched) {
        return 0;
      }
    }

    let score = 0;
    let maxPossible = 0;

    // 1. Core Nouns (Weight: 40)
    if (qNouns.length > 0) {
      maxPossible += 40;
      const matchedCount = qNouns.filter((n) => itTokens.has(n) || itText.includes(n)).length;
      score += (matchedCount / qNouns.length) * 40;
    }

    // 2. Colors (Weight: 25)
    if (qColors.length > 0) {
      maxPossible += 25;
      const colorMatched = qColors.some((c) => itTokens.has(c) || itText.includes(c));
      if (colorMatched) {
        score += 25;
      } else {
        score -= 10;
      }
    }

    // 3. Sizes / Dimensions (Weight: 25)
    if (qSizes.length > 0) {
      maxPossible += 25;
      const sizeMatched = qSizes.some((s) => itTokens.has(s) || itText.includes(s));
      if (sizeMatched) {
        score += 25;
      } else {
        score -= 10;
      }
    }

    // 4. Modifiers & general keywords (Weight: 20)
    if (qGeneral.length > 0) {
      maxPossible += 20;
      const matchedGen = qGeneral.filter((g) => itTokens.has(g) || itText.includes(g)).length;
      score += (matchedGen / qGeneral.length) * 20;
    }

    if (maxPossible === 0) {
      let matchedWords = 0;
      for (const word of qTokens) {
        if (itText.includes(word)) matchedWords++;
      }
      return matchedWords > 0 ? (matchedWords / qTokens.length) * 0.6 : 0;
    }

    return Math.max(0, Math.min(0.95, (score / maxPossible) * 0.9));
  }

  private normalizeItemText(text: string): string {
    if (!text) return '';
    return text
      .toLowerCase()
      .replace(/(\d+)\s*inch(es)?/gi, '$1in')
      .replace(/(\d+)\s*\"/gi, '$1in')
      .replace(/(\d+)\s*in\b/gi, '$1in')
      .replace(/\bt-?shirt\b/gi, 'tshirt')
      .replace(/\btee\b/gi, 'tshirt')
      .replace(/\bhoodies\b/gi, 'hoodie')
      .replace(/\bcoasters\b/gi, 'coaster')
      .replace(/\bstands\b/gi, 'stand')
      .replace(/\bidols\b/gi, 'idol')
      .replace(/\bclocks\b/gi, 'clock')
      .replace(/\bcustom\b/gi, 'customize')
      .replace(/\bcustomized\b/gi, 'customize')
      .replace(/\blight\s*gray\b/gi, 'lightgray')
      .replace(/\blight\s*grey\b/gi, 'lightgray')
      .replace(/\bnavy\s*blue\b/gi, 'navyblue')
      .replace(/[^a-z0-9]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
