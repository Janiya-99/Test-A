ALTER TABLE `rules`
  ADD COLUMN `profit_loss_by_paid_amount` TINYINT(1) DEFAULT 0 AFTER `advanced_invoice_generation`;
