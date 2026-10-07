import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SalesInvoiceDocument, SalesInvoiceStatus } from '../../../database/entities/sales-invoice-document.entity';
import { SalesInvoiceItem } from '../../../database/entities/sales-invoice-item.entity';
import { SalesInvoiceErpNextService } from './sales-invoice-erpnext.service';
import { SalesOrderService } from '../../sales-order/services/sales-order.service';
import { SalesOrderErpNextService } from '../../sales-order/services/sales-order-erpnext.service';
import { AuditService } from '../../audit/audit.service';
import { CreateSalesInvoiceDto } from '../dto/create-sales-invoice.dto';
import { ConvertOrderToInvoiceDto } from '../dto/convert-order-to-invoice.dto';
import { UpdateSalesInvoiceDto } from '../dto/update-sales-invoice.dto';

@Injectable()
export class SalesInvoiceService {
  private readonly logger = new Logger(SalesInvoiceService.name);

  constructor(
    @InjectRepository(SalesInvoiceDocument)
    private readonly invoiceRepo: Repository<SalesInvoiceDocument>,
    @InjectRepository(SalesInvoiceItem)
    private readonly itemRepo: Repository<SalesInvoiceItem>,
    private readonly erpNextService: SalesInvoiceErpNextService,
    private readonly salesOrderService: SalesOrderService,
    private readonly salesOrderErpNextService: SalesOrderErpNextService,
    private readonly auditService: AuditService,
  ) {}

  private computeInvoiceFinancials(items: any[]) {
    let subtotal = 0;
    let totalDiscount = 0;
    let taxableAmount = 0;
    let totalTax = 0;

    const computedItems = items.map((it) => {
      const qty = Number(it.qty) || 1;
      const rate = Number(it.rate) || 0;
      const discountPercentage = Number(it.discount_percentage) || 0;
      let discountAmount = Number(it.discount_amount) || 0;

      if (!discountAmount && discountPercentage > 0) {
        discountAmount = (qty * rate * discountPercentage) / 100;
      }

      const lineTotal = qty * rate;
      const taxableLine = Math.max(0, lineTotal - discountAmount);
      const taxPercentage = Number(it.tax_percentage) || 18;
      const taxAmount = (taxableLine * taxPercentage) / 100;

      subtotal += lineTotal;
      totalDiscount += discountAmount;
      taxableAmount += taxableLine;
      totalTax += taxAmount;

      return {
        ...it,
        qty,
        rate,
        discount_percentage: discountPercentage,
        discount_amount: Number(discountAmount.toFixed(2)),
        tax_percentage: taxPercentage,
        tax_amount: Number(taxAmount.toFixed(2)),
        amount: Number(taxableLine.toFixed(2)),
      };
    });

    const cgst = Number((totalTax / 2).toFixed(2));
    const sgst = Number((totalTax / 2).toFixed(2));
    const grandTotal = Number((taxableAmount + totalTax).toFixed(2));

    return {
      computedItems,
      subtotal: Number(subtotal.toFixed(2)),
      totalDiscount: Number(totalDiscount.toFixed(2)),
      taxableAmount: Number(taxableAmount.toFixed(2)),
      cgst,
      sgst,
      igst: 0,
      totalTax: Number(totalTax.toFixed(2)),
      grandTotal,
    };
  }

  async createSalesInvoice(dto: CreateSalesInvoiceDto, user = 'User'): Promise<SalesInvoiceDocument> {
    const rawItems = Array.isArray(dto.items) && dto.items.length > 0 ? dto.items : [];
    if (rawItems.length === 0) {
      throw new BadRequestException('Sales Invoice must contain at least 1 line item.');
    }

    const { computedItems, subtotal, totalDiscount, taxableAmount, cgst, sgst, igst, totalTax, grandTotal } =
      this.computeInvoiceFinancials(rawItems);

    const todayIso = new Date().toISOString().split('T')[0];
    const defaultDue = new Date();
    defaultDue.setDate(defaultDue.getDate() + 30);
    const year = new Date().getFullYear();
    let generatedNumber = dto.invoice_number;
    if (!generatedNumber) {
      const count = await this.invoiceRepo.count();
      const nextNum = String(count + 1).padStart(5, '0');
      generatedNumber = `SINV-${year}-${nextNum}`;
    }

    const invoiceDoc = this.invoiceRepo.create({
      invoice_number: generatedNumber,
      sales_order_id: dto.sales_order_id || '',
      erpnext_so_id: dto.erpnext_so_id || '',
      customer_name: (dto.customer_name || 'Walk-in Customer').trim(),
      customer_email: dto.customer_email || '',
      customer_phone: dto.customer_phone || '',
      customer_gstin: dto.customer_gstin || '',
      billing_address: dto.billing_address || '',
      shipping_address: dto.shipping_address || '',
      posting_date: dto.posting_date || todayIso,
      due_date: dto.due_date || defaultDue.toISOString().split('T')[0],
      payment_terms: dto.payment_terms || 'Net 30',
      currency: dto.currency || 'INR',
      update_stock: dto.update_stock !== undefined ? dto.update_stock : true,
      status: SalesInvoiceStatus.DRAFT,
      subtotal,
      total_discount: totalDiscount,
      taxable_amount: taxableAmount,
      cgst,
      sgst,
      igst,
      total_tax: totalTax,
      grand_total: grandTotal,
      created_by: user,
    });

    const savedDoc = await this.invoiceRepo.save(invoiceDoc);

    const itemsToSave = computedItems.map((it) =>
      this.itemRepo.create({
        sales_invoice_id: savedDoc.id,
        item_code: it.item_code,
        item_name: it.item_name || it.item_code,
        description: it.description || it.item_name || '',
        hsn_code: it.hsn_code || '',
        qty: it.qty,
        uom: it.uom || 'Nos',
        rate: it.rate,
        discount_percentage: it.discount_percentage,
        discount_amount: it.discount_amount,
        tax_percentage: it.tax_percentage,
        tax_amount: it.tax_amount,
        amount: it.amount,
        warehouse: it.warehouse || 'Stores - woodwolf',
        cost_center: it.cost_center || 'Main - woodwolf',
      }),
    );

    await this.itemRepo.save(itemsToSave);

    await this.auditService.log(
      'SALES_INVOICE',
      savedDoc.id,
      'SALES_INVOICE_CREATED',
      `Sales Invoice ${savedDoc.invoice_number} created`,
      { invoice_number: savedDoc.invoice_number, grand_total: savedDoc.grand_total },
      user,
    );

    return this.getInvoiceById(savedDoc.id);
  }

  /**
   * 1-Click Conversion: Converts an existing Sales Order into a valid Sales Invoice
   */
  async convertSalesOrderToInvoice(dto: ConvertOrderToInvoiceDto, user = 'User'): Promise<SalesInvoiceDocument> {
    const order = await this.salesOrderService.getOrderById(dto.sales_order_id);
    if (!order) {
      throw new NotFoundException(`Sales order with ID ${dto.sales_order_id} not found.`);
    }

    const todayIso = new Date().toISOString().split('T')[0];
    const defaultDue = new Date();
    defaultDue.setDate(defaultDue.getDate() + 30);

    const generatedNumber = `WW-SINV-${Math.floor(10000 + Math.random() * 90000)}`;

    const invoiceDoc = this.invoiceRepo.create({
      invoice_number: generatedNumber,
      sales_order_id: order.id,
      erpnext_so_id: order.erpnext_so_id || '',
      customer_name: order.customer_name,
      customer_email: order.customer_email,
      customer_phone: order.customer_phone,
      customer_gstin: order.customer_gstin,
      billing_address: order.billing_address,
      shipping_address: order.shipping_address,
      posting_date: dto.posting_date || todayIso,
      due_date: dto.due_date || defaultDue.toISOString().split('T')[0],
      payment_terms: dto.payment_terms || 'Net 30',
      currency: order.currency || 'INR',
      update_stock: dto.update_stock !== undefined ? dto.update_stock : true,
      status: SalesInvoiceStatus.DRAFT,
      subtotal: order.subtotal,
      total_discount: order.total_discount,
      taxable_amount: order.taxable_amount,
      cgst: order.cgst,
      sgst: order.sgst,
      igst: order.igst,
      total_tax: order.total_tax,
      grand_total: order.grand_total,
      created_by: user,
    });

    const savedDoc = await this.invoiceRepo.save(invoiceDoc);

    const itemsToSave = (order.items || []).map((it) =>
      this.itemRepo.create({
        sales_invoice_id: savedDoc.id,
        item_code: it.item_code,
        item_name: it.item_name,
        description: it.description,
        hsn_code: it.hsn_code,
        qty: it.qty,
        uom: it.uom,
        rate: it.rate,
        discount_percentage: it.discount_percentage,
        discount_amount: it.discount_amount,
        tax_percentage: it.tax_percentage,
        tax_amount: it.tax_amount,
        amount: it.amount,
        warehouse: it.warehouse || 'Stores - woodwolf',
        cost_center: 'Main - woodwolf',
      }),
    );

    await this.itemRepo.save(itemsToSave);

    await this.auditService.log(
      'SALES_INVOICE',
      savedDoc.id,
      'SALES_ORDER_CONVERTED_TO_INVOICE',
      `Sales Order ${order.order_id} converted to Invoice ${savedDoc.invoice_number}`,
      {
        invoice_number: savedDoc.invoice_number,
        from_sales_order: order.order_id,
        erpnext_so_id: order.erpnext_so_id,
      },
      user,
    );

    // Automatically push to ERPNext
    return this.approveAndPushToErpNext(savedDoc.id, user);
  }

  async getAllInvoices(status?: string, search?: string): Promise<SalesInvoiceDocument[]> {
    const qb = this.invoiceRepo
      .createQueryBuilder('si')
      .leftJoinAndSelect('si.items', 'items')
      .orderBy('si.created_at', 'DESC');

    if (status && status !== 'ALL') {
      qb.andWhere('si.status = :status', { status });
    }

    if (search && search.trim()) {
      const s = `%${search.trim().toLowerCase()}%`;
      qb.andWhere(
        '(LOWER(si.invoice_number) LIKE :s OR LOWER(si.customer_name) LIKE :s OR LOWER(si.erpnext_invoice_id) LIKE :s)',
        { s },
      );
    }

    return qb.getMany();
  }

  async getInvoiceById(id: string): Promise<SalesInvoiceDocument> {
    const inv = await this.invoiceRepo.findOne({
      where: [{ id }, { invoice_number: id }],
      relations: ['items'],
    });
    if (!inv) {
      throw new NotFoundException(`Sales Invoice with ID ${id} not found.`);
    }
    return inv;
  }

  async updateInvoiceData(id: string, dto: UpdateSalesInvoiceDto, user = 'User'): Promise<SalesInvoiceDocument> {
    const inv = await this.getInvoiceById(id);
    if (dto.customer_name) inv.customer_name = dto.customer_name;
    if (dto.customer_email !== undefined) inv.customer_email = dto.customer_email;
    if (dto.customer_phone !== undefined) inv.customer_phone = dto.customer_phone;
    if (dto.customer_gstin !== undefined) inv.customer_gstin = dto.customer_gstin;
    if (dto.billing_address !== undefined) inv.billing_address = dto.billing_address;
    if (dto.shipping_address !== undefined) inv.shipping_address = dto.shipping_address;
    if (dto.posting_date) inv.posting_date = dto.posting_date;
    if (dto.due_date) inv.due_date = dto.due_date;
    if (dto.payment_terms) inv.payment_terms = dto.payment_terms;
    if (dto.status) inv.status = dto.status as SalesInvoiceStatus;

    await this.invoiceRepo.save(inv);

    await this.auditService.log(
      'SALES_INVOICE',
      inv.id,
      'SALES_INVOICE_UPDATED',
      `Sales Invoice ${inv.invoice_number} updated`,
      { invoice_number: inv.invoice_number },
      user,
    );

    return this.getInvoiceById(inv.id);
  }

  async approveAndPushToErpNext(id: string, user = 'User'): Promise<SalesInvoiceDocument> {
    const inv = await this.getInvoiceById(id);

    // 1. Ensure Customer exists in ERPNext
    const customerErpName = await this.salesOrderErpNextService.ensureCustomerExists(
      inv.customer_name,
      inv.customer_email,
      inv.customer_phone,
      inv.customer_gstin,
    );

    // 2. Prepare Taxes
    const taxes: any[] = [];
    if (inv.cgst > 0) {
      taxes.push({
        charge_type: 'On Net Total',
        account_head: 'Output Tax CGST - woodwolf',
        rate: 9,
        tax_amount: inv.cgst,
        description: 'CGST 9%',
      });
    }
    if (inv.sgst > 0) {
      taxes.push({
        charge_type: 'On Net Total',
        account_head: 'Output Tax SGST - woodwolf',
        rate: 9,
        tax_amount: inv.sgst,
        description: 'SGST 9%',
      });
    }
    if (inv.igst > 0) {
      taxes.push({
        charge_type: 'On Net Total',
        account_head: 'Output Tax IGST - woodwolf',
        rate: 18,
        tax_amount: inv.igst,
        description: 'IGST 18%',
      });
    }

    // 3. Post to ERPNext Sales Invoice
    const erpResult = await this.erpNextService.createSalesInvoiceInERPNext({
      doctype: 'Sales Invoice',
      customer: customerErpName,
      posting_date: inv.posting_date,
      due_date: inv.due_date || inv.posting_date,
      update_stock: inv.update_stock ? 1 : 0,
      remarks: `Sales Invoice ${inv.invoice_number} ${inv.erpnext_so_id ? `linked to SO ${inv.erpnext_so_id}` : ''}`,
      items: inv.items.map((it) => ({
        sales_order: inv.erpnext_so_id || undefined,
        item_code: it.item_code,
        item_name: it.item_name,
        description: it.description,
        qty: Number(it.qty),
        rate: Number(it.rate),
        uom: it.uom,
        discount_percentage: Number(it.discount_percentage),
        discount_amount: Number(it.discount_amount),
        warehouse: it.warehouse,
      })),
      taxes,
    });

    if (erpResult.success) {
      inv.status = SalesInvoiceStatus.SYNCED_ERP;
      inv.erpnext_invoice_id = erpResult.erpnext_invoice_id || '';
      inv.erpnext_sync_status = 'SYNCED';
      inv.erpnext_error = '';
      inv.erpnext_response = erpResult.raw_response;
    } else {
      inv.erpnext_sync_status = 'FAILED';
      inv.erpnext_error = erpResult.user_friendly_error || erpResult.error_message || 'ERPNext submission error';
    }

    await this.invoiceRepo.save(inv);

    await this.auditService.log(
      'SALES_INVOICE',
      inv.id,
      erpResult.success ? 'SALES_INVOICE_SYNCED_ERP' : 'SALES_INVOICE_SYNC_FAILED',
      erpResult.success ? `Sales Invoice synced to ERPNext as ${inv.erpnext_invoice_id}` : `Sales Invoice sync failed: ${inv.erpnext_error}`,
      { erpnext_invoice_id: inv.erpnext_invoice_id, success: erpResult.success },
      user,
    );

    return this.getInvoiceById(inv.id);
  }

  async deleteInvoice(id: string): Promise<{ success: boolean; message: string }> {
    const inv = await this.getInvoiceById(id);
    await this.itemRepo.delete({ sales_invoice_id: inv.id });
    await this.invoiceRepo.delete(inv.id);
    return { success: true, message: `Sales invoice ${inv.invoice_number} deleted successfully.` };
  }

  async getDashboardStats() {
    const totalInvoices = await this.invoiceRepo.count();
    const syncedInvoices = await this.invoiceRepo.count({ where: { status: SalesInvoiceStatus.SYNCED_ERP } });
    const draftInvoices = await this.invoiceRepo.count({ where: { status: SalesInvoiceStatus.DRAFT } });

    const totalRevenueRes = await this.invoiceRepo
      .createQueryBuilder('si')
      .select('SUM(si.grand_total)', 'total')
      .getRawOne();

    return {
      totalInvoices,
      syncedInvoices,
      draftInvoices,
      totalInvoicedAmount: Number(totalRevenueRes?.total || 0),
    };
  }
}
