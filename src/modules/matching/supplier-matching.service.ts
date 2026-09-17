import { Injectable, Logger } from '@nestjs/common';
import { ErpNextService } from '../purchasing-erpnext/erpnext.service';
import { ExtractedSupplier, SupplierMatchResult } from '../../common/interfaces/invoice-schema.interface';
import { ErpSupplier } from '../../database/entities/erp-supplier.entity';

@Injectable()
export class SupplierMatchingService {
  private readonly logger = new Logger(SupplierMatchingService.name);

  constructor(private readonly erpNextService: ErpNextService) {}

  async matchSupplier(extracted: ExtractedSupplier): Promise<SupplierMatchResult> {
    const suppliers = await this.erpNextService.getAllSuppliers();
    const extractedGstin = (extracted.gstin || '').trim().toUpperCase();
    const extractedName = (extracted.name || '').trim();
    const normalizedExtractedName = this.normalizeName(extractedName);

    // 1. Exact GSTIN Match (100% confidence)
    if (extractedGstin) {
      const gstinMatch = suppliers.find(
        (s) => s.gstin && s.gstin.trim().toUpperCase() === extractedGstin
      );
      if (gstinMatch) {
        return {
          matched: true,
          supplier_id: gstinMatch.name,
          supplier_name: gstinMatch.supplier_name,
          gstin: gstinMatch.gstin,
          match_type: 'EXACT_GSTIN',
          confidence: 0.99,
        };
      }
    }

    // 2. Exact Supplier Name Match (98% confidence)
    if (extractedName) {
      const exactMatch = suppliers.find(
        (s) => (s.supplier_name || s.name || '').toLowerCase() === extractedName.toLowerCase()
      );
      if (exactMatch) {
        return {
          matched: true,
          supplier_id: exactMatch.name,
          supplier_name: exactMatch.supplier_name,
          gstin: exactMatch.gstin,
          match_type: 'EXACT_NAME',
          confidence: 0.98,
        };
      }

      // 3. Normalized Name Match (94% confidence)
      const normalizedMatch = suppliers.find(
        (s) => this.normalizeName(s.supplier_name || s.name) === normalizedExtractedName
      );
      if (normalizedMatch) {
        return {
          matched: true,
          supplier_id: normalizedMatch.name,
          supplier_name: normalizedMatch.supplier_name,
          gstin: normalizedMatch.gstin,
          match_type: 'NORMALIZED_NAME',
          confidence: 0.94,
        };
      }

      // 4. Fuzzy Levenshtein / Similarity Matching
      let bestMatch: ErpSupplier | null = null;
      let highestSimilarity = 0;

      const candidates: Array<{
        supplier_id: string;
        supplier_name: string;
        gstin: string;
        confidence: number;
      }> = [];

      for (const s of suppliers) {
        const sNorm = this.normalizeName(s.supplier_name || s.name);
        const sim = this.calculateSimilarity(normalizedExtractedName, sNorm);
        if (sim >= 0.6) {
          candidates.push({
            supplier_id: s.name,
            supplier_name: s.supplier_name,
            gstin: s.gstin,
            confidence: Number(sim.toFixed(2)),
          });
        }
        if (sim > highestSimilarity) {
          highestSimilarity = sim;
          bestMatch = s;
        }
      }

      if (bestMatch && highestSimilarity >= 0.75) {
        return {
          matched: true,
          supplier_id: bestMatch.name,
          supplier_name: bestMatch.supplier_name,
          gstin: bestMatch.gstin,
          match_type: 'FUZZY_NAME',
          confidence: Number(highestSimilarity.toFixed(2)),
          all_candidates: candidates.sort((a, b) => b.confidence - a.confidence),
        };
      }
    }

    return {
      matched: false,
      supplier_id: null,
      supplier_name: null,
      gstin: null,
      match_type: 'NONE',
      confidence: 0,
      all_candidates: [],
    };
  }

  private normalizeName(name: string): string {
    if (!name) return '';
    return name
      .toLowerCase()
      .replace(/\b(pvt|ltd|limited|private|llc|inc|corp|corporation|co|company|enterprises|enterprise|industries|industry|traders|trading|agency|agencies|handicrafts|handicraft|stores|store|suppliers|supplier|studio|opc)\b/gi, '')
      .replace(/[^a-z0-9]/gi, '')
      .trim();
  }

  private calculateSimilarity(str1: string, str2: string): number {
    if (!str1 || !str2) return 0;
    if (str1 === str2) return 1;

    // Dice Coefficient on bigrams
    const bigrams1 = this.getBigrams(str1);
    const bigrams2 = this.getBigrams(str2);

    let intersection = 0;
    const map = new Map<string, number>();
    for (const b of bigrams1) {
      map.set(b, (map.get(b) || 0) + 1);
    }
    for (const b of bigrams2) {
      const count = map.get(b) || 0;
      if (count > 0) {
        intersection++;
        map.set(b, count - 1);
      }
    }

    const total = bigrams1.length + bigrams2.length;
    return total > 0 ? (2.0 * intersection) / total : 0;
  }

  private getBigrams(str: string): string[] {
    const bigrams: string[] = [];
    for (let i = 0; i < str.length - 1; i++) {
      bigrams.push(str.slice(i, i + 2));
    }
    return bigrams;
  }
}
