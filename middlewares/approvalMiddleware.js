const db = require('../db/db');
const promisePool = db.promise();

/**
 * Middleware to intercept PUT, PATCH, DELETE operations on records pending approval.
 * @param {string} tableName - The name of the table to check
 * @param {string} idColumn - The primary key column name (default 'id')
 * @param {string} paramKey - The route parameter key holding the record ID (default 'id')
 */
const preventModificationIfPending = (tableName, idColumn = 'id', paramKey = 'id') => {
  return async (req, res, next) => {
    let actualTable = tableName;
    if (tableName === 'product') actualTable = 'item';

    let actualIdCol = idColumn;
    let recordId;

    if (typeof idColumn === 'string' && idColumn.startsWith('req.')) {
      const parts = idColumn.split('.');
      const source = parts[1] === 'body' ? req.body : req.params;
      const key = parts[2];
      recordId = source?.[key];
      actualIdCol = key;
    } else {
      recordId = req.params[paramKey] || req.params[idColumn] || req.body?.[paramKey] || req.body?.[idColumn] || req.params.id;
    }

    // Default primary key columns if not explicit
    if (!actualIdCol || actualIdCol === 'id' || actualIdCol.startsWith('req.')) {
      if (actualTable === 'item') actualIdCol = 'idItem';
      else if (actualTable === 'customer') actualIdCol = 'idCustomer';
      else if (actualTable === 'supplier') actualIdCol = 'idSupplier';
      else if (actualTable === 'invoice') actualIdCol = 'idInvoice';
      else if (actualTable === 'grn') actualIdCol = 'idGRN';
      else if (actualTable === 'customer_return') actualIdCol = 'idCustomer_Return';
      else if (actualTable === 'damage_note') actualIdCol = 'idDamage_note';
      else actualIdCol = 'id';
    }

    if (!recordId) {
      recordId = req.params.idItem || req.params.idCustomer || req.params.idSupplier || req.params.idInvoice || req.params.idGRN || req.params.id;
    }

    if (!recordId) {
      return next(); // If no ID, skip
    }

    try {
      const [rows] = await promisePool.query(
        `SELECT approval_status FROM ?? WHERE ?? = ? LIMIT 1`,
        [actualTable, actualIdCol, recordId]
      );

      if (rows.length > 0) {
        if (rows[0].approval_status === 'PENDING_APPROVAL') {
          return res.status(403).json({
            success: false,
            message: 'Record is pending approval and cannot be modified or deleted.'
          });
        }
      }

      next();
    } catch (error) {
      console.error(`Approval Middleware Error [${actualTable}]:`, error.message);
      next();
    }
  };
};

module.exports = {
  preventModificationIfPending
};
