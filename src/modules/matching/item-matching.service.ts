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

    // 4. Exact Item Name Match
    const cleanDesc = codePrefixMatch ? codePrefixMatch[2].trim() : rawDesc;
    const cleanNormDesc = this.normalizeItemText(cleanDesc);
    const exactNameMatch = items.find(
      (i) => i.item_name.toLowerCase() === rawDesc.toLowerCase() ||
             this.normalizeItemText(i.item_name) === normDesc ||
             i.item_name.toLowerCase() === cleanDesc.toLowerCase() ||
             this.normalizeItemText(i.item_name) === cleanNormDesc
    );
    if (exactNameMatch) {
      return {
        item_code: exactNameMatch.item_code,
        item_name: exactNameMatch.item_name,
        uom: exactNameMatch.stock_uom,
        confidence: 0.95,
        match_reason: 'Exact Item Title match',
        match_type: 'EXACT_NAME',
      };
    }

    // 4. Normalized Name & Dimension Match (e.g. "WOOD WALL SHELF 18\"" -> "Wooden Wall Shelf - 18 Inch")
    const candidates: Array<{
      item_code: string;
      item_name: string;
      confidence: number;
    }> = [];

    let bestMatch: ErpItem | null = null;
    let highestSim = 0;
    let bestReason = '';

    for (const erpItem of items) {
      const erpNorm = this.normalizeItemText(erpItem.item_name + ' ' + (erpItem.description || ''));
      const sim = this.calculateTokenSimilarity(normDesc, erpNorm);

      // Check dimension match (e.g. 18", 18 inch, 4ft, 2m)
      const dimExtracted = this.extractDimensions(rawDesc);
      const dimErp = this.extractDimensions(erpItem.item_name);
      let dimBonus = 0;
      if (dimExtracted && dimErp && dimExtracted === dimErp) {
        dimBonus = 0.15;
      }

      const totalScore = Math.min(0.99, sim + dimBonus);

      if (totalScore >= 0.5) {
        candidates.push({
          item_code: erpItem.item_code,
          item_name: erpItem.item_name,
          confidence: Number(totalScore.toFixed(2)),
        });
      }

      if (totalScore > highestSim) {
        highestSim = totalScore;
        bestMatch = erpItem;
        bestReason = dimBonus > 0
          ? 'Semantic name match + dimension match'
          : 'Fuzzy semantic keyword match';
      }
    }

    if (bestMatch && highestSim >= 0.65) {
      return {
        item_code: bestMatch.item_code,
        item_name: bestMatch.item_name,
        uom: bestMatch.stock_uom,
        confidence: Number(highestSim.toFixed(2)),
        match_reason: bestReason,
        match_type: highestSim >= 0.85 ? 'SEMANTIC' : 'FUZZY',
        candidates: candidates.sort((a, b) => b.confidence - a.confidence).slice(0, 5),
      };
    }

    return {
      item_code: null,
      item_name: null,
      confidence: 0,
      match_reason: 'No matching ERPNext item found with sufficient confidence',
      match_type: 'NONE',
      candidates: candidates.sort((a, b) => b.confidence - a.confidence).slice(0, 5),
    };
  }

  private normalizeItemText(text: string): string {
    if (!text) return '';
    return text
      .toLowerCase()
      .replace(/(\d+)\s*inch(es)?/g, '$1in')
      .replace(/(\d+)\s*\"/g, '$1in')
      .replace(/(\d+)\s*ft/g, '$1ft')
      .replace(/(\d+)\s*feet/g, '$1ft')
      .replace(/[^a-z0-9]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private extractDimensions(text: string): string | null {
    if (!text) return null;
    const match = text.match(/\b(\d+)\s*(inch|\"|in|ft|feet|m|meter|cm|mm)\b/i);
    if (match) {
      return match[1] + (match[2].startsWith('"') || match[2].startsWith('i') ? 'in' : match[2].toLowerCase());
    }
    return null;
  }

  private calculateTokenSimilarity(text1: string, text2: string): number {
    const tokens1 = new Set(text1.split(' ').filter((t) => t.length > 1));
    const tokens2 = new Set(text2.split(' ').filter((t) => t.length > 1));

    if (tokens1.size === 0 || tokens2.size === 0) return 0;

    let overlap = 0;
    for (const t of tokens1) {
      if (tokens2.has(t)) {
        overlap++;
      } else {
        // substring check
        for (const t2 of tokens2) {
          if (t.length > 3 && t2.includes(t)) {
            overlap += 0.5;
            break;
          }
        }
      }
    }

    return (2.0 * overlap) / (tokens1.size + tokens2.size);
  }
}
