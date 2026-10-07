import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SalesOrderDocument, SalesOrderStatus, SalesOrderSource } from '../../../database/entities/sales-order-document.entity';
import { SalesOrderItem } from '../../../database/entities/sales-order-item.entity';
import { SalesOrderErpNextService } from './sales-order-erpnext.service';
import { AuditService } from '../../audit/audit.service';
import { CreateSalesOrderDto } from '../dto/create-sales-order.dto';
import { UpdateSalesOrderDto } from '../dto/update-sales-order.dto';

@Injectable()
export class SalesOrderService {
  private readonly logger = new Logger(SalesOrderService.name);

  constructor(
    @InjectRepository(SalesOrderDocument)
    private readonly orderRepo: Repository<SalesOrderDocument>,
    @InjectRepository(SalesOrderItem)
    private readonly itemRepo: Repository<SalesOrderItem>,
    private readonly erpNextService: SalesOrderErpNextService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Recalculates line items and invoice tax breakdown (CGST, SGST, IGST)
   */
  private computeOrderFinancials(items: any[]) {
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

  async createSalesOrder(dto: CreateSalesOrderDto, user = 'User'): Promise<SalesOrderDocument> {
    try {
      const rawItems = Array.isArray(dto.items) && dto.items.length > 0 ? dto.items : [];
      if (rawItems.length === 0) {
        throw new BadRequestException('Sales Order must contain at least 1 line item.');
      }

      const { computedItems, subtotal, totalDiscount, taxableAmount, cgst, sgst, igst, totalTax, grandTotal } =
        this.computeOrderFinancials(rawItems);

      const todayIso = new Date().toISOString().split('T')[0];
      const defaultDelivery = new Date();
      defaultDelivery.setDate(defaultDelivery.getDate() + 7);
      const year = new Date().getFullYear();
      let generatedOrderId = dto.order_id;
      if (!generatedOrderId) {
        const count = await this.orderRepo.count();
        const nextNum = String(count + 1).padStart(5, '0');
        generatedOrderId = `SO-${year}-${nextNum}`;
      }

      const orderDoc = this.orderRepo.create({
        order_id: generatedOrderId,
        customer_name: (dto.customer_name || 'Walk-in Customer').trim(),
        customer_email: dto.customer_email || '',
        customer_phone: dto.customer_phone || '',
        customer_gstin: dto.customer_gstin || '',
        billing_address: dto.billing_address || '',
        shipping_address: dto.shipping_address || '',
        order_date: dto.order_date || todayIso,
        delivery_date: dto.delivery_date || defaultDelivery.toISOString().split('T')[0],
        po_no: dto.po_no || '',
        currency: dto.currency || 'INR',
        source: (dto.source as SalesOrderSource) || SalesOrderSource.MANUAL,
        status: SalesOrderStatus.DRAFT,
        subtotal,
        total_discount: totalDiscount,
        taxable_amount: taxableAmount,
        cgst,
        sgst,
        igst,
        total_tax: totalTax,
        grand_total: grandTotal,
        raw_ai_input: dto.raw_ai_input || '',
        created_by: user,
      });

      const savedDoc = await this.orderRepo.save(orderDoc);

      const itemsToSave = computedItems.map((it) =>
        this.itemRepo.create({
          sales_order_id: savedDoc.id,
          sales_order: savedDoc,
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
          delivery_date: it.delivery_date || savedDoc.delivery_date,
        }),
      );

      await this.itemRepo.save(itemsToSave);

      try {
        await this.auditService.log(
          'SALES_ORDER',
          savedDoc.id,
          'SALES_ORDER_CREATED',
          `Sales Order ${savedDoc.order_id} created`,
          { order_id: savedDoc.order_id, source: savedDoc.source, grand_total: savedDoc.grand_total },
          user,
        );
      } catch (auditErr) {
        this.logger.warn(`Audit log failed for order ${savedDoc.order_id}: ${auditErr.message}`);
      }

      return this.getOrderById(savedDoc.id);
    } catch (err: any) {
      this.logger.error(`Failed to create sales order: ${err.message}`, err.stack);
      throw new BadRequestException(err.message || 'Failed to create sales order');
    }
  }

  async getAllOrders(status?: string, search?: string): Promise<SalesOrderDocument[]> {
    const qb = this.orderRepo
      .createQueryBuilder('so')
      .leftJoinAndSelect('so.items', 'items')
      .orderBy('so.created_at', 'DESC');

    if (status && status !== 'ALL') {
      qb.andWhere('so.status = :status', { status });
    }

    if (search && search.trim()) {
      const s = `%${search.trim().toLowerCase()}%`;
      qb.andWhere(
        '(LOWER(so.order_id) LIKE :s OR LOWER(so.customer_name) LIKE :s OR LOWER(so.erpnext_so_id) LIKE :s)',
        { s },
      );
    }

    return qb.getMany();
  }

  async getOrderById(id: string): Promise<SalesOrderDocument> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
    const order = await this.orderRepo.findOne({
      where: isUuid ? [{ id }, { order_id: id }] : [{ order_id: id }],
      relations: ['items'],
    });
    if (!order) {
      throw new NotFoundException(`Sales Order with ID ${id} not found.`);
    }
    return order;
  }

  async updateOrderData(id: string, dto: UpdateSalesOrderDto, user = 'User'): Promise<SalesOrderDocument> {
    const order = await this.getOrderById(id);

    if (dto.customer_name) order.customer_name = dto.customer_name.trim();
    if (dto.customer_email !== undefined) order.customer_email = dto.customer_email;
    if (dto.customer_phone !== undefined) order.customer_phone = dto.customer_phone;
    if (dto.customer_gstin !== undefined) order.customer_gstin = dto.customer_gstin;
    if (dto.billing_address !== undefined) order.billing_address = dto.billing_address;
    if (dto.shipping_address !== undefined) order.shipping_address = dto.shipping_address;
    if (dto.delivery_date) order.delivery_date = dto.delivery_date;
    if (dto.status) order.status = dto.status as SalesOrderStatus;

    if (Array.isArray(dto.items)) {
      await this.itemRepo.delete({ sales_order_id: order.id });

      const { computedItems, subtotal, totalDiscount, taxableAmount, cgst, sgst, igst, totalTax, grandTotal } =
        this.computeOrderFinancials(dto.items);

      order.subtotal = subtotal;
      order.total_discount = totalDiscount;
      order.taxable_amount = taxableAmount;
      order.cgst = cgst;
      order.sgst = sgst;
      order.igst = igst;
      order.total_tax = totalTax;
      order.grand_total = grandTotal;

      const newItems = computedItems.map((it) =>
        this.itemRepo.create({
          sales_order_id: order.id,
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
          delivery_date: it.delivery_date || order.delivery_date,
        }),
      );
      await this.itemRepo.save(newItems);
    }

    await this.orderRepo.save(order);

    await this.auditService.log(
      'SALES_ORDER',
      order.id,
      'SALES_ORDER_UPDATED',
      `Sales Order ${order.order_id} updated`,
      { order_id: order.order_id },
      user,
    );

    return this.getOrderById(order.id);
  }

  /**
   * Approves order and posts to live ERPNext Sales Order API
   */
  async approveAndPushToErpNext(id: string, user = 'User'): Promise<SalesOrderDocument> {
    const order = await this.getOrderById(id);

    // 1. Ensure Customer exists in ERPNext
    const customerErpName = await this.erpNextService.ensureCustomerExists(
      order.customer_name,
      order.customer_email,
      order.customer_phone,
      order.customer_gstin,
    );

    // 2. Ensure Customer Billing & Shipping addresses exist in ERPNext
    const customerAddressName = order.billing_address
      ? await this.erpNextService.ensureCustomerAddressExists(customerErpName, order.billing_address, 'Billing')
      : undefined;

    const shippingAddressName = order.shipping_address
      ? await this.erpNextService.ensureCustomerAddressExists(customerErpName, order.shipping_address, 'Shipping')
      : customerAddressName;

    // 3. Ensure all items exist in ERPNext (Strict validation)
    const resolvedItems: any[] = [];
    for (const it of order.items || []) {
      try {
        const erpItemCode = await this.erpNextService.ensureItemExists(
          it.item_code,
          it.item_name,
          it.uom,
          it.hsn_code,
          it.rate,
        );
        if (!erpItemCode) {
          throw new Error(`Item ${it.item_code || it.item_name} could not be validated in ERPNext`);
        }
        resolvedItems.push({
          ...it,
          erpItemCode,
        });
      } catch (itemErr: any) {
        order.erpnext_sync_status = 'FAILED';
        order.erpnext_error = itemErr.message || `Item validation failed for ${it.item_code}`;
        await this.orderRepo.save(order);
        throw new BadRequestException(order.erpnext_error);
      }
    }

    // 4. Prepare taxes table
    const taxes: any[] = [];
    if (order.cgst > 0) {
      taxes.push({
        charge_type: 'On Net Total',
        account_head: 'Output Tax CGST - woodwolf',
        rate: 9,
        tax_amount: order.cgst,
        description: 'CGST 9%',
      });
    }
    if (order.sgst > 0) {
      taxes.push({
        charge_type: 'On Net Total',
        account_head: 'Output Tax SGST - woodwolf',
        rate: 9,
        tax_amount: order.sgst,
        description: 'SGST 9%',
      });
    }
    if (order.igst > 0) {
      taxes.push({
        charge_type: 'On Net Total',
        account_head: 'Output Tax IGST - woodwolf',
        rate: 18,
        tax_amount: order.igst,
        description: 'IGST 18%',
      });
    }

    // 5. Post to ERPNext
    const erpResult = await this.erpNextService.createSalesOrderInERPNext({
      doctype: 'Sales Order',
      customer: customerErpName,
      transaction_date: order.order_date,
      delivery_date: order.delivery_date,
      po_no: order.po_no,
      customer_address: customerAddressName || undefined,
      shipping_address_name: shippingAddressName || undefined,
      billing_address: order.billing_address || undefined,
      shipping_address: order.shipping_address || order.billing_address || undefined,
      remarks: `Sales Order ${order.order_id} generated via Woodwolf Sales Module`,
      items: resolvedItems.map((it) => ({
        item_code: it.erpItemCode || it.item_code,
        item_name: it.item_name,
        description: it.description,
        qty: Number(it.qty),
        rate: Number(it.rate),
        uom: it.uom,
        discount_percentage: Number(it.discount_percentage),
        discount_amount: Number(it.discount_amount),
        warehouse: it.warehouse,
        delivery_date: it.delivery_date || order.delivery_date,
      })),
      taxes,
    });

    if (erpResult.success) {
      order.status = SalesOrderStatus.SYNCED_ERP;
      order.erpnext_so_id = erpResult.erpnext_so_id || '';
      order.erpnext_sync_status = 'SYNCED';
      order.erpnext_error = '';
      order.erpnext_response = erpResult.raw_response;
    } else {
      order.erpnext_sync_status = 'FAILED';
      order.erpnext_error = erpResult.user_friendly_error || erpResult.error_message || 'ERPNext submission error';
    }

    await this.orderRepo.save(order);

    await this.auditService.log(
      'SALES_ORDER',
      order.id,
      erpResult.success ? 'SALES_ORDER_SYNCED_ERP' : 'SALES_ORDER_SYNC_FAILED',
      erpResult.success ? `Sales Order synced to ERPNext as ${order.erpnext_so_id}` : `Sales Order sync failed: ${order.erpnext_error}`,
      { erpnext_so_id: order.erpnext_so_id, success: erpResult.success, error: order.erpnext_error },
      user,
    );

    if (!erpResult.success) {
      throw new BadRequestException(order.erpnext_error);
    }

    return this.getOrderById(order.id);
  }

  async deleteOrder(id: string): Promise<{ success: boolean; message: string }> {
    const order = await this.getOrderById(id);
    await this.itemRepo.delete({ sales_order_id: order.id });
    await this.orderRepo.delete(order.id);
    return { success: true, message: `Sales order ${order.order_id} deleted successfully.` };
  }

  async getDashboardStats() {
    const totalOrders = await this.orderRepo.count();
    const syncedOrders = await this.orderRepo.count({ where: { status: SalesOrderStatus.SYNCED_ERP } });
    const draftOrders = await this.orderRepo.count({ where: { status: SalesOrderStatus.DRAFT } });
    const voiceOrders = await this.orderRepo.count({ where: { source: SalesOrderSource.AI_VOICE } });
    const chatOrders = await this.orderRepo.count({ where: { source: SalesOrderSource.AI_CHAT } });
    const ocrOrders = await this.orderRepo.count({ where: { source: SalesOrderSource.AI_OCR } });

    const totalRevenueRes = await this.orderRepo
      .createQueryBuilder('so')
      .select('SUM(so.grand_total)', 'total')
      .getRawOne();

    return {
      totalOrders,
      syncedOrders,
      draftOrders,
      aiDistribution: {
        voice: voiceOrders,
        chat: chatOrders,
        ocr: ocrOrders,
        manual: totalOrders - (voiceOrders + chatOrders + ocrOrders),
      },
      totalRevenue: Number(totalRevenueRes?.total || 0),
    };
  }
}
