const crypto = require('crypto');
const axios = require('axios');
const db = require('../db/db');
const promisePool = db.promise();
// Note: In Sprint 3 we just log the dispatch. In Sprint 4/5 we will call specific DB services.

exports.handleApprovalCallback = async (req, res) => {
  try {
    const signature = req.headers['x-approval-signature'];
    const payloadString = JSON.stringify(req.body);

    // Validate Signature
    const expectedSignature = crypto
      .createHmac('sha256', process.env.WEBHOOK_SECRET || 'SUPER_SECRET_WEBHOOK_KEY')
      .update(payloadString)
      .digest('hex');

    if (signature !== expectedSignature) {
      console.warn('Invalid Webhook Signature');
      return res.status(401).json({ success: false, message: 'Invalid signature' });
    }

    const { requestId, erp_record_id, action_type, status, resolved_at } = req.body;

    // Based on action_type, update the specific table
    let tableName = '';
    let idColumn = '';
    
    // Simple mapping based on the plan (Sprint 3 setup)
    switch (action_type) {
      case 'CREATE_INVOICE':
      case 'EDIT_INVOICE':
      case 'DELETE_INVOICE':
      case 'CREDIT_LIMIT_OVERRIDE':
      case 'APPLY_INVOICE_DISCOUNT':
      case 'MAKE_CHEQUE_PAYMENT':
        tableName = 'invoice';
        idColumn = 'idInvoice';
        break;
      case 'CREATE_GRN':
        tableName = 'grn';
        idColumn = 'idGRN';
        break;
      case 'ADD_PRODUCT':
      case 'EDIT_PRODUCT':
      case 'DELETE_PRODUCT':
        tableName = 'item';
        idColumn = 'idItem';
        break;
      case 'ADD_CUSTOMER':
      case 'EDIT_CUSTOMER':
      case 'DELETE_CUSTOMER':
        tableName = 'customer';
        idColumn = 'idCustomer';
        break;
      case 'ADD_SUPPLIER':
      case 'EDIT_SUPPLIER':
      case 'DELETE_SUPPLIER':
        tableName = 'supplier';
        idColumn = 'idSupplier';
        break;
      case 'CREATE_CUSTOMER_RETURN':
        tableName = 'customer_return';
        idColumn = 'idCustomer_return';
        break;
      case 'CREATE_PURCHASE_RETURN':
        tableName = 'purchase_return';
        idColumn = 'idPurchase_return';
        break;
      case 'CREATE_DAMAGE_NOTE':
        tableName = 'damage_note';
        idColumn = 'idDamage_note';
        break;
      case 'CREATE_PO':
      case 'CREATE_PURCHASE_ORDER':
        tableName = 'purchase_orders';
        idColumn = 'idPurchase_orders';
        break;
      case 'CREATE_ESTIMATE':
      case 'EDIT_ESTIMATE':
      case 'DELETE_ESTIMATE':
        tableName = 'estimates';
        idColumn = 'idEstimates';
        break;
      case 'CREATE_QUOTATION':
      case 'EDIT_QUOTATION':
      case 'DELETE_QUOTATION':
        tableName = 'quotation';
        idColumn = 'idQuotation';
        break;
      case 'RECORD_EXPENSE':
      case 'CREATE_EXPENSE':
        tableName = 'expences';
        idColumn = 'idExpences';
        break;
      default:
        console.warn('Unknown action_type in webhook:', action_type);
        return res.status(400).json({ success: false, message: 'Unknown action type' });
    }

    let payloadSummary = req.body.payload_summary;
    while (typeof payloadSummary === 'string') {
      try {
        payloadSummary = JSON.parse(payloadSummary);
      } catch (e) {
        break;
      }
    }
    payloadSummary = payloadSummary || {};

    if (tableName) {
      let newStatus = 'PENDING_APPROVAL';
      if (status === 'APPROVED') {
        newStatus = 'ACTIVE';
      } else if (status === 'REJECTED') {
        if (
          action_type === 'EDIT_PRODUCT' || action_type === 'DELETE_PRODUCT' ||
          action_type === 'EDIT_CUSTOMER' || action_type === 'DELETE_CUSTOMER' ||
          action_type === 'EDIT_SUPPLIER' || action_type === 'DELETE_SUPPLIER' ||
          action_type === 'EDIT_INVOICE' || action_type === 'DELETE_INVOICE'
        ) {
          // Rejection discards proposed edit/delete; existing live record returns to ACTIVE
          newStatus = 'ACTIVE';
        } else {
          newStatus = 'REJECTED';
        }
      } else if (status === 'PENDING') {
        newStatus = 'PENDING_APPROVAL';
      }

      const resolvedAtValue =
        status === 'PENDING'
          ? null
          : (resolved_at ? new Date(resolved_at) : new Date()).toISOString().slice(0, 19).replace('T', ' ');

      if (erp_record_id && erp_record_id !== 'null' && erp_record_id !== 'undefined') {
        const tablesWithStatus = ['item', 'supplier', 'customer', 'damage_note'];
        if (tablesWithStatus.includes(tableName)) {
          const activeStatus = (status === 'APPROVED' || newStatus === 'ACTIVE') ? '1' : '0';
          await promisePool.query(
            `UPDATE ?? SET approval_status = ?, Status = ?, approved_at = ?, approval_request_id = ? WHERE ?? = ?`,
            [tableName, newStatus, activeStatus, resolvedAtValue, requestId, idColumn, erp_record_id]
          );
        } else {
          await promisePool.query(
            `UPDATE ?? SET approval_status = ?, approved_at = ?, approval_request_id = ? WHERE ?? = ?`,
            [tableName, newStatus, resolvedAtValue, requestId, idColumn, erp_record_id]
          );
        }
      }

      // Trigger side-effects based on module when APPROVED
      if (status === 'APPROVED') {
        if (action_type === 'EDIT_PRODUCT') {
          try {
            const productController = require('./productController');
            if (payloadSummary.pending_updates) {
              await productController.applyPendingProductUpdate(erp_record_id, payloadSummary.pending_updates);
              console.log(`[WEBHOOK] Staged EDIT_PRODUCT updates applied for item #${erp_record_id}`);
            }
          } catch (editProdErr) {
            console.error('[WEBHOOK] Error applying staged EDIT_PRODUCT updates:', editProdErr);
          }
        } else if (action_type === 'DELETE_PRODUCT') {
          try {
            await promisePool.query('DELETE FROM item WHERE idItem = ?', [erp_record_id]);
            console.log(`[WEBHOOK] Staged DELETE_PRODUCT executed for item #${erp_record_id}`);
          } catch (delProdErr) {
            console.error('[WEBHOOK] Error executing staged DELETE_PRODUCT:', delProdErr);
          }
        } else if (action_type === 'CREATE_CUSTOMER' || action_type === 'ADD_CUSTOMER') {
          try {
             const customerController = require('./customerController');
             if (payloadSummary.pending_updates && customerController.applyPendingCustomerCreate) {
               await customerController.applyPendingCustomerCreate(payloadSummary.pending_updates);
               console.log(`[WEBHOOK] Staged CREATE_CUSTOMER executed`);
             }
          } catch (createCustErr) {
             console.error('[WEBHOOK] Error applying staged CREATE_CUSTOMER updates:', createCustErr);
          }
        } else if (action_type === 'CREATE_PRODUCT' || action_type === 'ADD_PRODUCT') {
          try {
             const productController = require('./productController');
             if (payloadSummary.pending_updates && productController.applyPendingProductCreate) {
               await productController.applyPendingProductCreate(payloadSummary.pending_updates);
               console.log(`[WEBHOOK] Staged ADD_PRODUCT executed`);
             }
          } catch (createProdErr) {
             console.error('[WEBHOOK] Error applying staged ADD_PRODUCT updates:', createProdErr);
          }
        } else if (action_type === 'EDIT_CUSTOMER') {
          try {
            const customerController = require('./customerController');
            if (payloadSummary.pending_updates && customerController.applyPendingCustomerUpdate) {
              await customerController.applyPendingCustomerUpdate(erp_record_id, payloadSummary.pending_updates);
            }
          } catch (editCustErr) {
            console.error('[WEBHOOK] Error applying staged EDIT_CUSTOMER updates:', editCustErr);
          }
        } else if (action_type === 'DELETE_CUSTOMER') {
          try {
            await promisePool.query('DELETE FROM customer WHERE idCustomer = ?', [erp_record_id]);
            console.log(`[WEBHOOK] Hard delete succeeded for customer #${erp_record_id}`);
          } catch (delCustErr) {
            console.warn('[WEBHOOK] Hard delete failed for customer, applying soft delete:', delCustErr.message);
            await promisePool.query("UPDATE customer SET status = 0, approval_status = 'DELETED' WHERE idCustomer = ?", [erp_record_id]);
          }
        } else if (action_type === 'EDIT_SUPPLIER') {
          try {
            const supplierController = require('./supplierController');
            if (payloadSummary.pending_updates && supplierController.applyPendingSupplierUpdate) {
              await supplierController.applyPendingSupplierUpdate(erp_record_id, payloadSummary.pending_updates);
            }
          } catch (editSuppErr) {
            console.error('[WEBHOOK] Error applying staged EDIT_SUPPLIER updates:', editSuppErr);
          }
        } else if (action_type === 'CREATE_SUPPLIER' || action_type === 'ADD_SUPPLIER') {
          try {
             const supplierController = require('./supplierController');
             if (payloadSummary.pending_updates && supplierController.applyPendingSupplierCreate) {
               await supplierController.applyPendingSupplierCreate(payloadSummary.pending_updates);
               console.log(`[WEBHOOK] Staged ADD_SUPPLIER executed`);
             }
          } catch (createSuppErr) {
             console.error('[WEBHOOK] Error applying staged ADD_SUPPLIER updates:', createSuppErr);
          }
        } else if (action_type === 'DELETE_SUPPLIER') {
          try {
            await promisePool.query('DELETE FROM supplier WHERE idSupplier = ?', [erp_record_id]);
            console.log(`[WEBHOOK] Hard delete succeeded for supplier #${erp_record_id}`);
          } catch (delSuppErr) {
            console.warn('[WEBHOOK] Hard delete failed for supplier, applying soft delete:', delSuppErr.message);
            await promisePool.query("UPDATE supplier SET isDeleted = 1, Status = '0', approval_status = 'DELETED' WHERE idSupplier = ?", [erp_record_id]);
          }
        } else if (action_type === 'CREATE_PO') {
          try {
            const purchaseOrderController = require('./purchaseOrderController');
            if (payloadSummary.pending_updates) {
              await purchaseOrderController.applyPendingPurchaseOrderCreate(payloadSummary.pending_updates);
            }
          } catch (e) {
            console.error('[WEBHOOK] Error creating PO:', e);
          }
        } else if (action_type === 'CREATE_PURCHASE_RETURN') {
          try {
            const purchaseReturnController = require('./purchaseReturnController');
            if (payloadSummary.pending_updates) {
              await purchaseReturnController.applyPendingPurchaseReturnCreate(payloadSummary.pending_updates);
            }
          } catch (e) {
            console.error('[WEBHOOK] Error creating purchase return:', e);
          }
        } else if (['CREATE_QUOTATION', 'EDIT_QUOTATION', 'DELETE_QUOTATION'].includes(action_type)) {
          try {
            const apiBase = process.env.SERVER_CALLBACK_URI || 'http://localhost:8000';
            let url = `${apiBase}/api/quotations`;
            let method = 'post';
            
            if (action_type === 'EDIT_QUOTATION') {
              url = `${apiBase}/api/quotations/${erp_record_id}`;
              method = 'put';
            } else if (action_type === 'DELETE_QUOTATION') {
              url = `${apiBase}/api/quotations/${erp_record_id}`;
              method = 'delete';
            }
            
            const payload = payloadSummary.pending_updates || {};
            // For delete, body is sent via data
            
            console.log(`[WEBHOOK] Replaying ${action_type} to ${url}`);
            const result = await axios({
              method: method,
              url: url,
              data: payload,
              headers: {
                'x-bypass-approval': 'true'
              }
            });
            console.log(`[WEBHOOK] Replay successful for ${action_type}`, result.data);
            
            // If creating, we might need to set the approval status of the newly created item
            if (action_type === 'CREATE_QUOTATION' && result.data?.quotation?.idQuotation) {
              await promisePool.query(
                `UPDATE quotation SET approval_status = 'ACTIVE', approved_at = ?, approval_request_id = ? WHERE idQuotation = ?`,
                [resolvedAtValue, requestId, result.data.quotation.idQuotation]
              );
            }
          } catch (e) {
            console.error(`[WEBHOOK] Error replaying ${action_type}:`, e.response?.data || e.message);
          }
        } else if (['CREATE_ESTIMATE', 'EDIT_ESTIMATE', 'DELETE_ESTIMATE'].includes(action_type)) {
          try {
            const apiBase = process.env.SERVER_CALLBACK_URI || 'http://localhost:8000';
            let url = `${apiBase}/api/estimates`;
            let method = 'post';
            
            if (action_type === 'EDIT_ESTIMATE') {
              url = `${apiBase}/api/estimates/${erp_record_id}`;
              method = 'put';
            } else if (action_type === 'DELETE_ESTIMATE') {
              url = `${apiBase}/api/estimates/${erp_record_id}`;
              method = 'delete';
            }
            
            const payload = payloadSummary.pending_updates || {};
            
            console.log(`[WEBHOOK] Replaying ${action_type} to ${url}`);
            const result = await axios({
              method: method,
              url: url,
              data: payload,
              headers: {
                'x-bypass-approval': 'true'
              }
            });
            console.log(`[WEBHOOK] Replay successful for ${action_type}`, result.data);
            
            // If creating, we might need to set the approval status of the newly created item
            if (action_type === 'CREATE_ESTIMATE' && result.data?.estimateId) {
              await promisePool.query(
                `UPDATE estimates SET approval_status = 'ACTIVE', approved_at = ?, approval_request_id = ? WHERE idEstimates = ?`,
                [resolvedAtValue, requestId, result.data.estimateId]
              );
            }
          } catch (e) {
            console.error(`[WEBHOOK] Error replaying ${action_type}:`, e.response?.data || e.message);
          }
        } else if (action_type === 'RECORD_EXPENSE') {
          try {
            const expenceController = require('./expenceController');
            if (payloadSummary.pending_updates) {
              await expenceController.applyPendingExpenseCreate(payloadSummary.pending_updates);
            }
          } catch (e) {
            console.error('[WEBHOOK] Error creating expense:', e);
          }
        } else if (['CREATE_INVOICE', 'APPLY_INVOICE_DISCOUNT', 'MAKE_CHEQUE_PAYMENT', 'CREDIT_LIMIT_OVERRIDE'].includes(action_type)) {
          try {
             const invoiceController = require('./invoiceController');
             if (payloadSummary.pending_updates) {
               const result = await invoiceController.applyPendingInvoiceCreate(payloadSummary.pending_updates, action_type);
               console.log(`[WEBHOOK] Staged ${action_type} executed:`, result);
               if (result && result.invoice_id) {
                 await promisePool.query(
                   `UPDATE invoice SET approval_status = 'ACTIVE', approved_at = ?, approval_request_id = ? WHERE idInvoice = ?`,
                   [resolvedAtValue, requestId, result.invoice_id]
                 );
               }
             }
          } catch (editErr) {
             console.error(`[WEBHOOK] Error executing ${action_type}:`, editErr);
          }
        } else if (action_type === 'EDIT_INVOICE') {
          try {
             const invoiceController = require('./invoiceController');
             if (payloadSummary.pending_updates) {
               await invoiceController.applyPendingInvoiceUpdate(erp_record_id, payloadSummary.pending_updates, action_type);
               console.log(`[WEBHOOK] Staged EDIT_INVOICE executed for invoice #${erp_record_id}`);
             }
          } catch (editErr) {
             console.error('[WEBHOOK] Error finalizing invoice side-effects:', editErr);
          }
        } else if (action_type === 'DELETE_INVOICE') {
          try {
            const invoiceController = require('./invoiceController');
            await invoiceController.applyPendingInvoiceDeletion(erp_record_id, payloadSummary.pending_updates || {});
            console.log(`[WEBHOOK] Staged DELETE_INVOICE executed for invoice #${erp_record_id}`);
          } catch (e) {
            console.error('[WEBHOOK] Error deleting invoice:', e);
          }
        } else if (action_type === 'CREATE_GRN') {
          // Future sprint extension
        } else if (['POS_APPLY_DISCOUNT', 'POS_ACCEPT_CHEQUE'].includes(action_type)) {
          try {
             const posController = require('./posController');
             if (payloadSummary.pending_updates) {
               await posController.applyPendingPosCreate(payloadSummary.pending_updates);
               console.log(`[WEBHOOK] Staged ${action_type} executed`);
             }
          } catch (editErr) {
             console.error(`[WEBHOOK] Error executing ${action_type}:`, editErr);
          }
        } else if (action_type === 'POS_VOID_REFUND') {
          try {
             const posController = require('./posController');
             if (payloadSummary.pending_updates) {
               await posController.applyPendingPosDeletion(erp_record_id, payloadSummary.pending_updates);
               console.log(`[WEBHOOK] Staged ${action_type} executed`);
             }
          } catch (editErr) {
             console.error(`[WEBHOOK] Error executing ${action_type}:`, editErr);
          }
        } else if (action_type === 'ASSIGN_STOCK_SALESPERSON') {
          try {
             const warehouseController = require('./warehouseController');
             if (payloadSummary.pending_updates) {
               await warehouseController.applyPendingAssignStock(erp_record_id, payloadSummary.pending_updates);
               console.log(`[WEBHOOK] Staged ${action_type} executed`);
             }
          } catch (err) {
             console.error(`[WEBHOOK] Error executing ${action_type}:`, err);
          }
        }
      }
    }

    res.status(200).json({ success: true, message: 'Webhook processed' });
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ success: false, message: 'Server error processing webhook' });
  }
};
