<?php
/**
 * Stock Correction Script for Double-Deduction Invoice Edit Bug (PHP Port)
 * 
 * Usage:
 *   1. CLI Dry Run:
 *      php fix_stock_discrepancies.php
 * 
 *   2. CLI Commit:
 *      php fix_stock_discrepancies.php --commit
 * 
 *   3. Browser Dry Run:
 *      Open http://yourdomain/fix_stock_discrepancies.php
 * 
 *   4. Browser Commit:
 *      Open http://yourdomain/fix_stock_discrepancies.php?commit=true
 */

// --- Database Configuration ---
define('DB_HOST', 'localhost');
define('DB_USER', 'asipbook_user');
define('DB_PASS', '0771924823*@');
define('DB_NAME', 'asipbook_invoice');
define('DB_CHARSET', 'utf8mb4');

// --- Setup Timezone ---
date_default_timezone_set('Asia/Colombo');

// --- Determine execution environment and parameters ---
$is_cli = (php_sapi_name() === 'cli');
$commit = false;

if ($is_cli) {
    global $argv;
    $commit = in_array('--commit', $argv);
} else {
    $commit = (isset($_GET['commit']) && ($_GET['commit'] === '1' || $_GET['commit'] === 'true'));
}

// Helper to log/print output
function output($message, $type = 'info') {
    global $is_cli;
    if ($is_cli) {
        echo $message . "\n";
    } else {
        $color = '#e2e8f0'; // default slate-200
        if ($type === 'success') $color = '#4ade80'; // green
        if ($type === 'error') $color = '#f87171'; // red
        if ($type === 'warning') $color = '#fbbf24'; // amber
        if ($type === 'header') $color = '#60a5fa'; // blue
        
        echo "<div style='color: {$color}; margin: 4px 0; font-family: monospace; white-space: pre-wrap;'>" . htmlspecialchars($message) . "</div>";
        // Flush buffer to browser immediately
        flush();
        ob_flush();
    }
}

// Start browser HTML output wrapper
if (!$is_cli) {
    ob_start();
    echo '<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>Stock Discrepancy Correction Tool</title>
        <style>
            body {
                background-color: #0f172a;
                color: #e2e8f0;
                font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                padding: 24px;
                max-width: 1200px;
                margin: 0 auto;
            }
            .console {
                background-color: #020617;
                border: 1px solid #334155;
                border-radius: 8px;
                padding: 16px;
                margin-top: 16px;
                box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
            }
            .header-panel {
                border-bottom: 1px solid #1e293b;
                padding-bottom: 16px;
                margin-bottom: 16px;
            }
            a.btn {
                display: inline-block;
                background-color: #2563eb;
                color: white;
                padding: 8px 16px;
                border-radius: 6px;
                text-decoration: none;
                font-weight: 600;
                font-size: 14px;
                transition: background-color 0.2s;
            }
            a.btn:hover {
                background-color: #1d4ed8;
            }
            a.btn-danger {
                background-color: #dc2626;
            }
            a.btn-danger:hover {
                background-color: #b91c1c;
            }
            table {
                width: 100%;
                border-collapse: collapse;
                margin: 16px 0;
                font-family: monospace;
            }
            th, td {
                border: 1px solid #334155;
                padding: 8px;
                text-align: left;
            }
            th {
                background-color: #1e293b;
                color: #38bdf8;
            }
            tr:nth-child(even) {
                background-color: #0f172a;
            }
        </style>
    </head>
    <body>
        <div class="header-panel">
            <h2>Stock Card Double-Deduction Correction Tool</h2>
            <p>Runs analysis and updates standard items and variations discrepancies.</p>';
            if ($commit) {
                echo '<a href="?commit=false" class="btn">Switch to DRY RUN Mode</a>';
            } else {
                echo '<a href="?commit=true" class="btn btn-danger">Switch to COMMIT Mode (Update Database)</a>';
            }
    echo '</div>
        <div class="console">';
}

output("==================================================", "header");
output("   STOCK CARD DOUBLE-DEDUCTION CORRECTION SCRIPT   ", "header");
output("==================================================", "header");
output("BRANCH FILTER: ALL", "warning");
output($commit ? "MODE: COMMIT (Applying updates to database)" : "MODE: DRY RUN (No database writes)", $commit ? "warning" : "info");
output("Starting analysis...\n");

try {
    // ----------------------------------------------------
    // Initialize PDO Connection
    // ----------------------------------------------------
    $dsn = "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=" . DB_CHARSET;
    $options = [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ];
    $pdo = new PDO($dsn, DB_USER, DB_PASS, $options);

    // Fetch active invoice IDs to skip deleted invoices
    $stmt = $pdo->query("SELECT idInvoice FROM invoice");
    $activeInvoiceIds = $stmt->fetchAll(PDO::FETCH_COLUMN);
    $activeInvoiceSet = [];
    foreach ($activeInvoiceIds as $id) {
        $activeInvoiceSet[strval($id)] = true;
    }

    // Fetch all items and their branch mappings
    $stmt = $pdo->query("SELECT idItem, Branch_idBranch FROM item");
    $itemBranchMap = [];
    foreach ($stmt->fetchAll() as $row) {
        $itemBranchMap[$row['idItem']] = intval($row['Branch_idBranch']);
    }

    // ----------------------------------------------------
    // 1. ANALYZE REGULAR ITEMS
    // ----------------------------------------------------
    output("Analyzing standard physical items...");
    $stmt = $pdo->query(
        "SELECT idItem, Description, Qty, Cost, Real_Cost, Rate, Branch_idBranch 
         FROM item 
         WHERE Type = '1' 
           AND idItem NOT IN (SELECT DISTINCT item_id FROM item_variations)"
    );
    $items = $stmt->fetchAll();

    $itemsMap = [];
    foreach ($items as $item) {
        $itemsMap[$item['idItem']] = [
            'description' => $item['Description'],
            'qty'         => floatval($item['Qty'] ?? 0),
            'cost'         => floatval($item['Cost'] ?? 0),
            'realCost'    => floatval($item['Real_Cost'] ?? 0),
            'rate'        => floatval($item['Rate'] ?? 0),
            'branchId'    => $item['Branch_idBranch'],
        ];
    }

    $stmt = $pdo->query(
        "SELECT Item_idItem, Transaction_ID, IN_Stock, Out_Stock 
         FROM stock_card 
         WHERE Transaction_Type IN ('INVOICE', 'INVOICE-UPDATE', 'INVOICE-UPDATE-REVERT')"
    );
    $stockCards = $stmt->fetchAll();

    $scGroups = [];
    foreach ($stockCards as $sc) {
        $itemId = $sc['Item_idItem'];
        $invoiceId = $sc['Transaction_ID'];
        if (!isset($itemsMap[$itemId])) continue;
        if (!isset($activeInvoiceSet[strval($invoiceId)])) continue; // Skip deleted invoices
        if (!isset($scGroups[$itemId])) $scGroups[$itemId] = [];
        if (!isset($scGroups[$itemId][$invoiceId])) $scGroups[$itemId][$invoiceId] = [];
        $scGroups[$itemId][$invoiceId][] = $sc;
    }

    $stmt = $pdo->query(
        "SELECT Item_idItem, Invoice_idInvoice, Qty, Discount_Type 
         FROM invoice_has_item"
    );
    $invoiceItems = $stmt->fetchAll();

    $activeGroups = [];
    foreach ($invoiceItems as $ii) {
        $itemId = $ii['Item_idItem'];
        $invoiceId = $ii['Invoice_idInvoice'];
        if (!isset($itemsMap[$itemId])) continue;
        if (!isset($activeGroups[$itemId])) $activeGroups[$itemId] = [];
        if (!isset($activeGroups[$itemId][$invoiceId])) $activeGroups[$itemId][$invoiceId] = [];
        $activeGroups[$itemId][$invoiceId][] = $ii;
    }

    $itemCorrections = [];
    foreach ($scGroups as $itemId => $invoices) {
        $itemTotalDiff = 0;

        foreach ($invoices as $invoiceId => $logs) {
            $totalDeducted = 0;
            foreach ($logs as $log) {
                $totalDeducted += (floatval($log['Out_Stock'] ?? 0) - floatval($log['IN_Stock'] ?? 0));
            }

            $activeQty = 0;
            $activeLines = isset($activeGroups[$itemId][$invoiceId]) ? $activeGroups[$itemId][$invoiceId] : [];
            foreach ($activeLines as $line) {
                $qty = floatval($line['Qty'] ?? 0);
                if ($line['Discount_Type'] === 'RTN') {
                    $activeQty -= $qty;
                } else {
                    $activeQty += $qty;
                }
            }

            $diff = $totalDeducted - $activeQty;
            if ($diff != 0) {
                $itemTotalDiff += $diff;
            }
        }

        if ($itemTotalDiff != 0) {
            $info = $itemsMap[$itemId];
            $itemCorrections[] = [
                'idItem'       => $itemId,
                'description'  => $info['description'],
                'branchId'     => $info['branchId'],
                'currentQty'   => $info['qty'],
                'overDeducted' => $itemTotalDiff, // positive means over-deducted (needs to be added back)
                'correctedQty' => $info['qty'] + $itemTotalDiff,
                'cost'         => $info['cost'],
                'realCost'     => $info['realCost'],
                'rate'         => $info['rate'],
            ];
        }
    }

    // ----------------------------------------------------
    // 2. ANALYZE VARIATIONS
    // ----------------------------------------------------
    output("Analyzing product variations...");
    $stmt = $pdo->query(
        "SELECT iv.id, iv.item_id, iv.description, iv.qty 
         FROM item_variations iv"
    );
    $variations = $stmt->fetchAll();

    $varMap = [];
    foreach ($variations as $v) {
        $varMap[$v['id']] = [
            'itemId'      => $v['item_id'],
            'description' => $v['description'],
            'qty'         => floatval($v['qty'] ?? 0),
        ];
    }

    $stmt = $pdo->query(
        "SELECT Product_idProduct, Variation_idVariation, Reference_ID, Quantity_Change 
         FROM product_history_log 
         WHERE Variation_idVariation IS NOT NULL 
           AND Reference_ID IS NOT NULL 
           AND Type IN ('Invoice Sale', 'Invoice Return', 'POS Sale (Variation)', 'POS Sale')"
    );
    $varLogs = $stmt->fetchAll();

    $varLogGroups = [];
    foreach ($varLogs as $log) {
        $vId = $log['Variation_idVariation'];
        $refId = $log['Reference_ID'];
        if (!isset($varMap[$vId])) continue;
        if (!isset($activeInvoiceSet[strval($refId)])) continue; // Skip deleted invoices
        if (!isset($varLogGroups[$vId])) $varLogGroups[$vId] = [];
        if (!isset($varLogGroups[$vId][$refId])) $varLogGroups[$vId][$refId] = [];
        $varLogGroups[$vId][$refId][] = $log;
    }

    $stmt = $pdo->query(
        "SELECT Item_idItem, Invoice_idInvoice, Variation_Id, Qty, Discount_Type 
         FROM invoice_has_item 
         WHERE Variation_Id IS NOT NULL AND Variation_Id > 0"
    );
    $varInvoiceItems = $stmt->fetchAll();

    $varActiveGroups = [];
    foreach ($varInvoiceItems as $ii) {
        $vId = $ii['Variation_Id'];
        $refId = $ii['Invoice_idInvoice'];
        if (!isset($varMap[$vId])) continue;
        if (!isset($varActiveGroups[$vId])) $varActiveGroups[$vId] = [];
        if (!isset($varActiveGroups[$vId][$refId])) $varActiveGroups[$vId][$refId] = [];
        $varActiveGroups[$vId][$refId][] = $ii;
    }

    $varCorrections = [];
    foreach ($varLogGroups as $vId => $invoices) {
        $totalDiff = 0;

        foreach ($invoices as $refId => $vLogs) {
            $loggedChange = 0;
            foreach ($vLogs as $l) {
                $loggedChange += floatval($l['Quantity_Change'] ?? 0);
            }

            $activeChange = 0;
            $activeLines = isset($varActiveGroups[$vId][$refId]) ? $varActiveGroups[$vId][$refId] : [];
            foreach ($activeLines as $line) {
                $qty = floatval($line['Qty'] ?? 0);
                if ($line['Discount_Type'] === 'RTN') {
                    $activeChange += $qty;
                } else {
                    $activeChange -= $qty;
                }
            }

            $diff = $loggedChange - $activeChange;
            if ($diff != 0) {
                $totalDiff += $diff;
            }
        }

        if ($totalDiff != 0) {
            $info = $varMap[$vId];
            $itemInfo = isset($itemBranchMap[$info['itemId']]) ? ['branchId' => $itemBranchMap[$info['itemId']]] : ['branchId' => 1];
            $varCorrections[] = [
                'id'           => $vId,
                'itemId'       => $info['itemId'],
                'description'  => $info['description'],
                'branchId'     => $itemInfo['branchId'],
                'currentQty'   => $info['qty'],
                'overDeducted' => -$totalDiff, // Negating diff because logged sale is negative, over-deducted means too negative
                'correctedQty' => $info['qty'] - $totalDiff,
            ];
        }
    }

    output("\nAnalysis complete.");
    output("Found " . count($itemCorrections) . " items requiring correction.");
    output("Found " . count($varCorrections) . " variations requiring correction.");

    if (count($itemCorrections) === 0 && count($varCorrections) === 0) {
        output("No stock discrepancies found. Everything is correct!", "success");
        exit(0);
    }

    // ----------------------------------------------------
    // 3. EXECUTE CORRECTIONS (IF COMMITTING)
    // ----------------------------------------------------
    if (!$commit) {
        output("\n================ DRY RUN RESULTS ================", "warning");
        if (count($itemCorrections) > 0) {
            output("\nStandard Item Corrections List:");
            if ($is_cli) {
                foreach ($itemCorrections as $c) {
                    output(sprintf(
                        "ID: %d | Name: %s | Branch: %d | Current: %.2f | Add Back: %.2f | New: %.2f",
                        $c['idItem'], $c['description'], $c['branchId'], $c['currentQty'], $c['overDeducted'], $c['correctedQty']
                    ));
                }
            } else {
                echo '<table>
                        <tr>
                            <th>ID</th>
                            <th>Name</th>
                            <th>Branch</th>
                            <th>Current Qty</th>
                            <th>Qty to Add Back</th>
                            <th>New Qty</th>
                        </tr>';
                foreach ($itemCorrections as $c) {
                    echo "<tr>
                            <td>{$c['idItem']}</td>
                            <td>" . htmlspecialchars($c['description']) . "</td>
                            <td>{$c['branchId']}</td>
                            <td>{$c['currentQty']}</td>
                            <td>{$c['overDeducted']}</td>
                            <td>{$c['correctedQty']}</td>
                          </tr>";
                }
                echo '</table>';
            }
        }

        if (count($varCorrections) > 0) {
            output("\nVariation Corrections List:");
            if ($is_cli) {
                foreach ($varCorrections as $c) {
                    output(sprintf(
                        "ID: %d | Name: %s | Item ID: %d | Current: %.2f | Add Back: %.2f | New: %.2f",
                        $c['id'], $c['description'], $c['itemId'], $c['currentQty'], $c['overDeducted'], $c['correctedQty']
                    ));
                }
            } else {
                echo '<table>
                        <tr>
                            <th>ID</th>
                            <th>Name</th>
                            <th>Item ID</th>
                            <th>Current Qty</th>
                            <th>Qty to Add Back</th>
                            <th>New Qty</th>
                        </tr>';
                foreach ($varCorrections as $c) {
                    echo "<tr>
                            <td>{$c['id']}</td>
                            <td>" . htmlspecialchars($c['description']) . "</td>
                            <td>{$c['itemId']}</td>
                            <td>{$c['currentQty']}</td>
                            <td>{$c['overDeducted']}</td>
                            <td>{$c['correctedQty']}</td>
                          </tr>";
                }
                echo '</table>';
            }
        }

        output("\nTo apply these corrections, run:");
        if ($is_cli) {
            output("  php fix_stock_discrepancies.php --commit", "success");
        } else {
            output("Click the \"Switch to COMMIT Mode\" button above or append ?commit=true to the URL.", "success");
        }
        exit(0);
    }

    // Process DB Updates inside Transaction
    output("\nApplying corrections to the database...", "warning");
    $pdo->beginTransaction();

    try {
        $dateTimeStr = date('Y-m-d H:i:s');

        // 1. Correct Standard Items
        foreach ($itemCorrections as $c) {
            output("Correcting Item {$c['idItem']} ({$c['description']}): adding back {$c['overDeducted']}");
            
            // A. Update item quantity
            $stmt = $pdo->prepare("UPDATE item SET Qty = Qty + ? WHERE idItem = ?");
            $stmt->execute([$c['overDeducted'], $c['idItem']]);

            // B. Insert correction log into stock_card
            $stmt = $pdo->prepare(
                "INSERT INTO stock_card 
                 (Date, Item_idItem, Description, Transaction_Type, Transaction_ID, Cost, Real_Cost, Sell_Price, IN_Stock, Out_Stock, SIH, Branch_idBranch) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            );
            $stmt->execute([
                $dateTimeStr,
                $c['idItem'],
                $c['description'] . " (Stock Correction)",
                "STOCK-ADJUSTMENT-FIX",
                "BUG-FIX-2026",
                $c['cost'],
                $c['realCost'],
                $c['rate'],
                $c['overDeducted'] > 0 ? $c['overDeducted'] : 0,
                $c['overDeducted'] < 0 ? -$c['overDeducted'] : 0,
                $c['correctedQty'],
                $c['branchId']
            ]);

            // C. Insert into product_history_log
            $stmt = $pdo->prepare(
                "INSERT INTO product_history_log 
                 (Product_idProduct, Variation_idVariation, Date_Time, Type, Description, Quantity_Change, Old_Quantity, New_Quantity, User_idUser, Branch_idBranch, Company_idCompany, Reference_ID) 
                 VALUES (?, NULL, NOW(), 'Stock Correction', 'Corrected double-deduction from invoice edits', ?, ?, ?, 1, ?, 1, NULL)"
            );
            $stmt->execute([
                $c['idItem'],
                $c['overDeducted'],
                $c['currentQty'],
                $c['correctedQty'],
                $c['branchId']
            ]);
        }

        // 2. Correct Variations
        foreach ($varCorrections as $c) {
            output("Correcting Variation {$c['id']} ({$c['description']}): adding back {$c['overDeducted']}");

            // A. Update variation quantity
            $stmt = $pdo->prepare("UPDATE item_variations SET qty = qty + ? WHERE id = ?");
            $stmt->execute([$c['overDeducted'], $c['id']]);

            // B. Insert variation history log
            $stmt = $pdo->prepare(
                "INSERT INTO product_history_log 
                 (Product_idProduct, Variation_idVariation, Date_Time, Type, Description, Quantity_Change, Old_Quantity, New_Quantity, User_idUser, Branch_idBranch, Company_idCompany, Reference_ID) 
                 VALUES (?, ?, NOW(), 'Stock Correction', 'Corrected double-deduction from invoice edits (variation)', ?, ?, ?, 1, ?, 1, NULL)"
            );
            $stmt->execute([
                $c['itemId'],
                $c['id'],
                $c['overDeducted'],
                $c['currentQty'],
                $c['correctedQty'],
                $c['branchId']
            ]);
        }

        // Commit transaction
        $pdo->commit();
        output("\nTransaction successfully committed. All stock levels updated!", "success");

    } catch (Exception $err) {
        output("\nError in updates, rolling back transaction: " . $err->getMessage(), "error");
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $err;
    }

} catch (Exception $error) {
    output("An error occurred during execution: " . $error->getMessage(), "error");
    exit(1);
}

// End browser console wrapper
if (!$is_cli) {
    echo '</div>
    </body>
    </html>';
}
exit(0);
