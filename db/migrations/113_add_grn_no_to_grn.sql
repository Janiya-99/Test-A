-- Migration: Add grn_no to grn table
ALTER TABLE `grn` ADD COLUMN `grn_no` VARCHAR(255) NULL DEFAULT NULL;

-- Backfill existing GRNs sequentially starting at GRN-1000 per branch
UPDATE grn g
JOIN (
  SELECT idGRN,
         ROW_NUMBER() OVER (PARTITION BY Branch_idBranch ORDER BY idGRN) - 1 + 1000 AS seq_num
  FROM grn
) seq ON g.idGRN = seq.idGRN
SET g.grn_no = CONCAT('GRN-', seq.seq_num)
WHERE g.grn_no IS NULL;
