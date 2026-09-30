// controllers/warehouseController.js
const conn = require("../db/db");
const db2 = require("../db/db2");
const userLogDbService = require("../services/userLogDBService");
const itemDbService = require("../services/productDBService");
const { productHistoryLogHelper } = itemDbService;
const branchDBService = require("../services/branchDBService");
const { getCompanyIdByBranch } = branchDBService;
const approvalService = require("../services/approvalService");
const stockCardDbService = require("../services/stockCardDBService");
const { postStockAdjustmentAccounting } = require("../services/inventoryAccountingService");

exports.createWarehouse = (req, res) => {
  const {
    branchId,
    companyId,
    userId,
    name,
    location = null,
    warehouseCode = null,
    warehouseType = "store",
    vehicleNumber = null,
    responsibleUserId = null,
    stockCount = 0,
    itemCount = 0,
    zones = [], // expected: [{ name, racks: [{ name, cells: [string] }] }]
  } = req.body || {};

  // ---- validation
  const errors = {};
  if (!companyId) errors.companyId = "companyId is required";
  if (!branchId) errors.branchId = "branchId is required";
  if (!userId) errors.userId = "userId is required";
  if (!name || !String(name).trim()) errors.name = "name is required";
  if (zones !== undefined && !Array.isArray(zones))
    errors.zones = "zones must be an array";
  if (warehouseType === "vehicle" && !String(vehicleNumber || "").trim())
    errors.vehicleNumber = "Vehicle number is required for vehicle warehouses";

  if (Object.keys(errors).length) {
    return res.status(400).json({ ok: false, errors });
  }

  // Resolve the Correct External Branch ID
  const resolveExternalBranchId = (inputBranchId, done) => {
    // 1. Try to find in Local DB (to resolve to external if different)
    const sqlLocal = `SELECT Name, Company_idCompany FROM branch WHERE idBranch = ?`;
    conn.query(sqlLocal, [inputBranchId], (err, localRows) => {
      if (err) return done(err);

      if (localRows && localRows.length > 0) {
        // Found locally -> Find matching record in DB2
        const localBranch = localRows[0];
        const sqlExternal = `SELECT idBranch FROM branch WHERE Name = ? AND Company_idCompany = ? LIMIT 1`;
        db2.query(
          sqlExternal,
          [localBranch.Name, localBranch.Company_idCompany],
          (err2, extRows) => {
            if (err2) return done(err2);
            if (!extRows || extRows.length === 0) {
              console.warn(
                `External branch not found for ${localBranch.Name}. Using input ID.`,
              );
              return done(null, inputBranchId);
            }
            return done(null, extRows[0].idBranch);
          },
        );
      } else {
        // Not found locally -> Check if it exists directly in DB2
        // (Maybe frontend sent the External ID directly)
        const sqlDirect = `SELECT idBranch FROM branch WHERE idBranch = ?`;
        db2.query(sqlDirect, [inputBranchId], (err3, db2Rows) => {
          if (err3) return done(err3);
          if (db2Rows && db2Rows.length > 0) {
            // It exists in DB2, so trust it
            return done(null, inputBranchId);
          }
          // Not found in either
          return done(
            new Error(
              `Branch ID ${inputBranchId} not found in Local or Remote DB`,
            ),
          );
        });
      }
    });
  };

  resolveExternalBranchId(branchId, (err, resolvedBranchId) => {
    if (err) {
      console.error("Branch resolution error:", err);
      return res
        .status(500)
        .json({ ok: false, message: "Branch resolution failed" });
    }

    // Normalize payload
    const warehouseRow = {
      branch_id: Number(resolvedBranchId), // Uses the resolved external ID
      Branch_BranchId: Number(resolvedBranchId), // Now setting this to resolved ID as FK is removed
      name: String(name).trim(),
      location: location ? String(location).trim() : null,
      warehouse_code: warehouseCode ? String(warehouseCode).trim() : null,
      warehouse_type: warehouseType === "vehicle" ? "vehicle" : "store",
      vehicle_number:
        warehouseType === "vehicle" ? String(vehicleNumber).trim() : null,
      responsible_user_id: responsibleUserId ? Number(responsibleUserId) : null,
      stock_count: Number(stockCount) || 0,
      item_count: Number(itemCount) || 0,
      created_by: Number(userId),
    };

    // —— Start transaction
    conn.getConnection((err, connection) => {
      if (err) {
        console.error("getConnection error:", err);
        return res.status(500).json({ ok: false, message: "Server error" });
      }

      connection.beginTransaction((err) => {
        if (err) {
          connection.release();
          console.error("beginTransaction error:", err);
          return res.status(500).json({ ok: false, message: "Server error" });
        }

        // 1) Insert warehouse
        const sqlWarehouse = `
        INSERT INTO warehouses
          (branch_id, name, location, warehouse_code, warehouse_type, vehicle_number, responsible_user_id, stock_count, item_count, created_by, Branch_BranchId)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
        const paramsWarehouse = [
          warehouseRow.branch_id,
          warehouseRow.name,
          warehouseRow.location,
          warehouseRow.warehouse_code,
          warehouseRow.warehouse_type,
          warehouseRow.vehicle_number,
          warehouseRow.responsible_user_id,
          warehouseRow.stock_count,
          warehouseRow.item_count,
          warehouseRow.created_by,
          warehouseRow.Branch_BranchId,
        ];

        connection.query(sqlWarehouse, paramsWarehouse, (err, wRes) => {
          if (err) {
            if (err.code === "ER_DUP_ENTRY") {
              return rollbackWith(409, {
                ok: false,
                message:
                  "A warehouse with this name or code already exists for this branch.",
                detail: err.sqlMessage,
              });
            }
            console.error("insert warehouse error:", err);
            return rollbackWith(500, { ok: false, message: "Server error" });
          }
          // Continue with zones insertion...
          // RE-ESTABLISH context variables that were previously in scope or ensure they are accessible
          const warehouseId = wRes.insertId;
          const createdZones = []; // for response & log
          // ... (Rest of the function continues inside this closure)

          // Helpers
          const trimOrNull = (v) => (v && String(v).trim()) || "";

          const normalizedZones = (() => {
            // Accept both new format and very old formats gracefully
            const arr = Array.isArray(zones) ? zones : [];
            const nz = arr
              .map((z) => {
                const zName = trimOrNull(z?.name);
                let racksIn = z?.racks ?? [];
                // older versions could send racks as array of strings
                if (Array.isArray(racksIn)) {
                  racksIn = racksIn.map((r) => {
                    if (r && typeof r === "object") {
                      return {
                        name: trimOrNull(r.name),
                        cells: Array.isArray(r.cells)
                          ? r.cells.map((c) => trimOrNull(c)).filter(Boolean)
                          : [],
                      };
                    }
                    // r was string
                    return { name: trimOrNull(r), cells: [] };
                  });
                } else {
                  racksIn = [];
                }
                return {
                  name: zName,
                  racks: racksIn.filter(
                    (r) =>
                      r.name || (Array.isArray(r.cells) && r.cells.length > 0),
                  ),
                };
              })
              .filter(
                (z) => z.name || (Array.isArray(z.racks) && z.racks.length > 0),
              );

            // Default if user didn't add anything: Zone 1 > Rack 1 > Cell 1
            if (nz.length === 0) {
              return [
                {
                  name: "Zone 1",
                  racks: [
                    {
                      name: "Rack 1",
                      cells: ["Cell 1"],
                    },
                  ],
                },
              ];
            }

            // Ensure each zone has at least one rack, and each rack has at least one cell
            nz.forEach((z) => {
              if (!Array.isArray(z.racks) || z.racks.length === 0) {
                z.racks = [{ name: "Rack 1", cells: ["Cell 1"] }];
              } else {
                z.racks = z.racks.map((r) => ({
                  name: r.name || "Rack 1",
                  cells:
                    Array.isArray(r.cells) && r.cells.length > 0
                      ? r.cells
                      : ["Cell 1"],
                }));
              }
            });

            return nz;
          })();

          // Insert cells for a rack
          const insertCellsForRack = (
            rackId,
            cellsArr,
            createdCells,
            cIndex,
            done,
          ) => {
            if (!Array.isArray(cellsArr) || cIndex >= cellsArr.length) {
              return done(null);
            }

            const rawC = cellsArr[cIndex];
            const cName = trimOrNull(rawC);
            if (!cName) {
              return insertCellsForRack(
                rackId,
                cellsArr,
                createdCells,
                cIndex + 1,
                done,
              );
            }

            const sqlCell = `INSERT INTO cells (rack_id, name) VALUES (?, ?)`;
            connection.query(sqlCell, [rackId, cName], (err, cRes) => {
              if (err) return done(err);
              createdCells.push({ id: cRes.insertId, name: cName });
              insertCellsForRack(
                rackId,
                cellsArr,
                createdCells,
                cIndex + 1,
                done,
              );
            });
          };

          // Insert racks (and nested cells) for a zone
          const insertRacksForZone = (
            zoneId,
            racksArr,
            createdRacks,
            rIndex,
            done,
          ) => {
            if (!Array.isArray(racksArr) || rIndex >= racksArr.length) {
              return done(null);
            }

            const rawR = racksArr[rIndex] || {};
            const rName = trimOrNull(rawR.name);
            const cellsArr = Array.isArray(rawR.cells) ? rawR.cells : [];

            if (!rName) {
              // If rack name missing, still insert (use fallback name)
              rawR.name = "Rack 1";
            }

            const sqlRack = `INSERT INTO racks (zone_id, name) VALUES (?, ?)`;
            connection.query(
              sqlRack,
              [zoneId, rName || "Rack 1"],
              (err, rRes) => {
                if (err) return done(err);

                const rackId = rRes.insertId;
                const createdCells = [];

                // ensure at least one cell
                const cellsNorm = cellsArr.length > 0 ? cellsArr : ["Cell 1"];

                insertCellsForRack(
                  rackId,
                  cellsNorm,
                  createdCells,
                  0,
                  (err) => {
                    if (err) return done(err);
                    createdRacks.push({
                      id: rackId,
                      name: rName || "Rack 1",
                      cells: createdCells,
                    });
                    insertRacksForZone(
                      zoneId,
                      racksArr,
                      createdRacks,
                      rIndex + 1,
                      done,
                    );
                  },
                );
              },
            );
          };

          // Insert zones sequentially
          const insertNextZone = (zIndex) => {
            if (zIndex >= normalizedZones.length) {
              // all zones done → write audit log, then commit
              return writeAuditLogAndCommit();
            }

            const z = normalizedZones[zIndex] || {};
            const zName = trimOrNull(z.name) || `Zone ${zIndex + 1}`;

            const sqlZone = `INSERT INTO zones (warehouse_id, name) VALUES (?, ?)`;
            connection.query(sqlZone, [warehouseId, zName], (err, zRes) => {
              if (err) {
                if (err.code === "ER_DUP_ENTRY") {
                  return rollbackWith(409, {
                    ok: false,
                    message: `Duplicate zone name: "${zName}" in this warehouse.`,
                  });
                }
                return rollbackWith(500, {
                  ok: false,
                  message: "Server error",
                });
              }

              const zoneId = zRes.insertId;
              const createdRacks = [];
              const racksArr = Array.isArray(z.racks)
                ? z.racks
                : [{ name: "Rack 1", cells: ["Cell 1"] }];

              insertRacksForZone(zoneId, racksArr, createdRacks, 0, (err) => {
                if (err) {
                  console.error("insertRacksForZone callback error:", err);
                  return rollbackWith(500, {
                    ok: false,
                    message: "Server error",
                  });
                }

                createdZones.push({
                  id: zoneId,
                  name: zName,
                  racks: createdRacks,
                });

                // next zone
                insertNextZone(zIndex + 1);
              });
            });
          };

          // 2) Audit log -> then commit
          const writeAuditLogAndCommit = () => {
            // Build a concise details JSON for the log (now includes cells)
            let totalRacks = 0;
            let totalCells = 0;
            createdZones.forEach((z) => {
              totalRacks += (z.racks || []).length;
              (z.racks || []).forEach((r) => {
                totalCells += (r.cells || []).length;
              });
            });

            const details = {
              name: warehouseRow.name,
              location: warehouseRow.location,
              warehouseCode: warehouseRow.warehouse_code,
              stockCount: warehouseRow.stock_count,
              itemCount: warehouseRow.item_count,
              zones: createdZones.map((z) => ({
                id: z.id,
                name: z.name,
                racks: (z.racks || []).map((r) => ({
                  id: r.id,
                  name: r.name,
                  cells: (r.cells || []).map((c) => ({
                    id: c.id,
                    name: c.name,
                  })),
                })),
              })),
              zoneCount: createdZones.length,
              rackCount: totalRacks,
              cellCount: totalCells,
            };

            // Capture client context (best effort)
            const ip =
              (req.headers["x-forwarded-for"] &&
                req.headers["x-forwarded-for"].split(",")[0].trim()) ||
              req.socket?.remoteAddress ||
              req.ip ||
              null;
            const ua = req.headers["user-agent"] || null;

            const sqlLog = `
          INSERT INTO warehouse_audit_logs
            (warehouse_id, branch_id, actor_user_id, action, details, ip_address, user_agent)
          VALUES (?, ?, ?, 'CREATE', ?, ?, ?)
        `;
            const paramsLog = [
              warehouseId,
              warehouseRow.branch_id,
              warehouseRow.created_by,
              JSON.stringify(details),
              ip,
              ua,
            ];

            connection.query(sqlLog, paramsLog, (err) => {
              if (err) {
                console.error("audit log insert error:", err);
                return rollbackWith(500, {
                  ok: false,
                  message: "Server error",
                });
              }

              // finally commit
              connection.commit((err) => {
                if (err) {
                  console.error("commit error:", err);
                  return rollbackWith(500, {
                    ok: false,
                    message: "Server error",
                  });
                }

                // success
                connection.release();
                // Log to Recent Activity
                userLogDbService
                  .insertLog(
                    warehouseRow.created_by,
                    new Date(),
                    "created",
                    warehouseId,
                    "Warehouse",
                    warehouseRow.branch_id,
                  )
                  .catch((err) =>
                    console.error("Recent Activity Log Error:", err),
                  );

                return res.status(201).json({
                  ok: true,
                  warehouse: {
                    id: warehouseId,
                    branch_id: warehouseRow.branch_id,
                    name: warehouseRow.name,
                    location: warehouseRow.location,
                    warehouse_code: warehouseRow.warehouse_code,
                    warehouse_type: warehouseRow.warehouse_type,
                    vehicle_number: warehouseRow.vehicle_number,
                    responsible_user_id: warehouseRow.responsible_user_id,
                    stock_count: warehouseRow.stock_count,
                    item_count: warehouseRow.item_count,
                    created_by: warehouseRow.created_by,
                    zones: createdZones,
                  },
                });
              });
            });
          };

          // kick off zones insertion
          insertNextZone(0);
        });

        // rollback helper
        function rollbackWith(statusCode, payload) {
          connection.rollback(() => {
            connection.release();
            res.status(statusCode).json(payload);
          });
        }
      });
    });
  });
};

exports.listWarehousesByBranch = async (req, res) => {
  const branchId = Number(req.query.branchId || req.params.branchId);
  const companyIdReq = Number(req.query.companyId);
  const allBranches = req.query.allBranches === "true" || req.query.allBranches === true || Boolean(companyIdReq);

  if (!branchId && !companyIdReq) {
    return res.status(400).json({ ok: false, message: "branchId or companyId is required" });
  }

  try {
    let targetBranchIds = [];
    const branchMap = {};

    if (allBranches) {
      let resolvedCompanyId = companyIdReq;
      if (!resolvedCompanyId && branchId) {
        resolvedCompanyId = await getCompanyIdByBranch(branchId);
      }

      if (resolvedCompanyId) {
        const [bRows] = await db2.promise().query(
          "SELECT idBranch, Name, isMainBranch FROM branch WHERE Company_idCompany = ? AND status = 1",
          [resolvedCompanyId]
        );
        (bRows || []).forEach((b) => {
          targetBranchIds.push(b.idBranch);
          branchMap[b.idBranch] = b;
        });
      }
    }

    if (targetBranchIds.length === 0) {
      if (branchId) {
        targetBranchIds = [branchId];
        try {
          const [bRows] = await db2.promise().query(
            "SELECT idBranch, Name, isMainBranch FROM branch WHERE idBranch = ?",
            [branchId]
          );
          if (bRows && bRows.length > 0) {
            branchMap[branchId] = bRows[0];
          }
        } catch (e) {
          console.error("Error fetching single branch info:", e);
        }
      } else {
        return res.json({ ok: true, warehouses: [] });
      }
    }

    const placeholders = (arr) => arr.map(() => "?").join(",");

    const sqlW = `
      SELECT
        w.id, w.branch_id, w.name, w.location, w.warehouse_code,
        w.warehouse_type, w.vehicle_number, w.responsible_user_id, w.created_by,
        COALESCE(SUM(CASE WHEN ib.qty > 0 AND (ib.grn_id IS NULL OR ib.grn_id = 0 OR g.Status = 1 OR g.Status = '1') THEN ib.qty ELSE 0 END), 0) AS stock_count,
        COALESCE(COUNT(DISTINCT CASE WHEN ib.qty > 0 AND (ib.grn_id IS NULL OR ib.grn_id = 0 OR g.Status = 1 OR g.Status = '1') THEN ib.item_id ELSE NULL END), 0) AS item_count
      FROM warehouses w
      LEFT JOIN item_batch ib ON ib.warehouse_id = w.id
      LEFT JOIN grn g ON ib.grn_id = g.idGRN
      WHERE w.branch_id IN (${placeholders(targetBranchIds)})
      GROUP BY w.id, w.branch_id, w.name, w.location, w.warehouse_code,
               w.warehouse_type, w.vehicle_number, w.responsible_user_id, w.created_by
      ORDER BY w.id DESC
    `;

    conn.query(sqlW, targetBranchIds, (err, wRows) => {
      if (err) {
        console.error("listWarehousesByBranch > warehouses error:", err);
        return res.status(500).json({ ok: false, message: "Server error" });
      }
      if (!wRows || wRows.length === 0) {
        return res.json({ ok: true, warehouses: [] });
      }

      const warehouseIds = wRows.map((r) => r.id);
      const responsibleUserIds = [
        ...new Set(wRows.map((r) => r.responsible_user_id).filter(Boolean)),
      ];

      const formatWarehouses = (warehouses, zonesByWh, responsibleUserMap) => {
        return warehouses.map((w) => {
          const ru = responsibleUserMap[w.responsible_user_id];
          return {
            id: w.id,
            branch_id: w.branch_id,
            branch_name: branchMap[w.branch_id]?.Name || `Branch ${w.branch_id}`,
            is_main_branch: branchMap[w.branch_id]?.isMainBranch === 1,
            name: w.name,
            location: w.location,
            warehouse_code: w.warehouse_code,
            warehouse_type: w.warehouse_type || "store",
            vehicle_number: w.vehicle_number || null,
            responsible_user_id: w.responsible_user_id || null,
            responsible_person_name: ru
              ? `${ru.First_Name || ""} ${ru.Last_Name || ""}`.trim()
              : null,
            responsible_person_phone: ru ? ru.Contact_No_01 || null : null,
            stock_count: w.stock_count,
            item_count: w.item_count,
            created_by: w.created_by,
            zones: zonesByWh[w.id] || [],
          };
        });
      };

      const withResponsibleUsers = (next) => {
        if (responsibleUserIds.length === 0) return next({});
        const sqlU = `
          SELECT idAsipiya_User, First_Name, Last_Name, Contact_No_01
          FROM asipiya_user
          WHERE idAsipiya_User IN (${placeholders(responsibleUserIds)})
        `;
        db2.query(sqlU, responsibleUserIds, (err, uRows) => {
          if (err) {
            console.error("listWarehousesByBranch > responsible users error:", err);
            return next({});
          }
          const map = {};
          (uRows || []).forEach((u) => {
            map[u.idAsipiya_User] = u;
          });
          next(map);
        });
      };

      // 1) Zones for all warehouses
      const sqlZ = `
        SELECT id, warehouse_id, name
        FROM zones
        WHERE warehouse_id IN (${placeholders(warehouseIds)})
        ORDER BY id
      `;
      conn.query(sqlZ, warehouseIds, (err, zRows) => {
        if (err) {
          console.error("listWarehousesByBranch > zones error:", err);
          return res.status(500).json({ ok: false, message: "Server error" });
        }

        const zonesByWh = {};
        const zoneIds = [];
        (zRows || []).forEach((z) => {
          zonesByWh[z.warehouse_id] = zonesByWh[z.warehouse_id] || [];
          zonesByWh[z.warehouse_id].push({ id: z.id, name: z.name, racks: [] });
          zoneIds.push(z.id);
        });

        // If no zones, send warehouses with empty zones
        if (zoneIds.length === 0) {
          return withResponsibleUsers((responsibleUserMap) =>
            res.json({ ok: true, warehouses: formatWarehouses(wRows, zonesByWh, responsibleUserMap) })
          );
        }

        // 2) Racks for all zones
        const sqlR = `
          SELECT id, zone_id, name
          FROM racks
          WHERE zone_id IN (${placeholders(zoneIds)})
          ORDER BY id
        `;
        conn.query(sqlR, zoneIds, (err, rRows) => {
          if (err) {
            console.error("listWarehousesByBranch > racks error:", err);
            return res.status(500).json({ ok: false, message: "Server error" });
          }

          const racksByZone = {};
          const rackIds = [];
          (rRows || []).forEach((r) => {
            racksByZone[r.zone_id] = racksByZone[r.zone_id] || [];
            racksByZone[r.zone_id].push({ id: r.id, name: r.name, cells: [] });
            rackIds.push(r.id);
          });

          // Attach rack shells to zones first
          Object.keys(zonesByWh).forEach((whId) => {
            zonesByWh[whId] = zonesByWh[whId].map((z) => ({
              ...z,
              racks: racksByZone[z.id] || [],
            }));
          });

          // If there are no racks, respond now
          if (rackIds.length === 0) {
            return withResponsibleUsers((responsibleUserMap) =>
              res.json({ ok: true, warehouses: formatWarehouses(wRows, zonesByWh, responsibleUserMap) })
            );
          }

          // 3) Cells for all racks
          const sqlC = `
            SELECT id, rack_id, name
            FROM cells
            WHERE rack_id IN (${placeholders(rackIds)})
            ORDER BY id
          `;
          conn.query(sqlC, rackIds, (err, cRows) => {
            if (err) {
              console.error("listWarehousesByBranch > cells error:", err);
              return res.status(500).json({ ok: false, message: "Server error" });
            }

            const cellsByRack = {};
            (cRows || []).forEach((c) => {
              cellsByRack[c.rack_id] = cellsByRack[c.rack_id] || [];
              cellsByRack[c.rack_id].push({ id: c.id, name: c.name });
            });

            // Attach cells to racks
            Object.keys(zonesByWh).forEach((whId) => {
              zonesByWh[whId] = zonesByWh[whId].map((z) => ({
                ...z,
                racks: (z.racks || []).map((r) => ({
                  ...r,
                  cells: cellsByRack[r.id] || [],
                })),
              }));
            });

            return withResponsibleUsers((responsibleUserMap) =>
              res.json({ ok: true, warehouses: formatWarehouses(wRows, zonesByWh, responsibleUserMap) })
            );
          });
        });
      });
    });
  } catch (err) {
    console.error("listWarehousesByBranch error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
};

exports.updateWarehouse = (req, res) => {
  const warehouseId = Number(req.params.id || req.body.id);
  const {
    name,
    location = null,
    warehouseCode = null,
    warehouseType = "store",
    vehicleNumber = null,
    responsibleUserId = null,
    zones = [],
    deletedZoneIds = [],
    deletedRackIds = [],
    deletedCellIds = [],
    stockCount, // optional
    itemCount, // optional
    userId, // actor for audit log (prefer this)
  } = req.body || {};

  // ---- validation
  const errors = {};
  if (!warehouseId) errors.id = "id is required";
  if (!name || !String(name).trim()) errors.name = "name is required";
  if (!Array.isArray(zones)) errors.zones = "zones must be an array";
  if (!Array.isArray(deletedZoneIds))
    errors.deletedZoneIds = "deletedZoneIds must be an array";
  if (!Array.isArray(deletedRackIds))
    errors.deletedRackIds = "deletedRackIds must be an array";
  if (!Array.isArray(deletedCellIds))
    errors.deletedCellIds = "deletedCellIds must be an array";
  if (warehouseType === "vehicle" && !String(vehicleNumber || "").trim())
    errors.vehicleNumber = "Vehicle number is required for vehicle warehouses";

  if (Object.keys(errors).length) {
    return res.status(400).json({ ok: false, errors });
  }

  // actor for audit log (best effort)
  const actorUserId =
    userId !== undefined && userId !== null
      ? Number(userId)
      : req.user && (req.user.idAsipiya_User || req.user.id || req.user.userId)
        ? Number(req.user.idAsipiya_User || req.user.id || req.user.userId)
        : req.session &&
            req.session.user &&
            (req.session.user.idAsipiya_User ||
              req.session.user.id ||
              req.session.user.userId)
          ? Number(
              req.session.user.idAsipiya_User ||
                req.session.user.id ||
                req.session.user.userId,
            )
          : req.headers["x-user-id"]
            ? Number(req.headers["x-user-id"])
            : null;

  const placeholders = (arr) => arr.map(() => "?").join(",");

  conn.getConnection((err, connection) => {
    if (err) {
      console.error("getConnection error:", err);
      return res.status(500).json({ ok: false, message: "Server error" });
    }

    connection.beginTransaction((err) => {
      if (err) {
        connection.release();
        console.error("beginTransaction error:", err);
        return res.status(500).json({ ok: false, message: "Server error" });
      }

      // 1) UPDATE warehouse core fields
      const setCols = [
        "name = ?",
        "location = ?",
        "warehouse_code = ?",
        "warehouse_type = ?",
        "vehicle_number = ?",
        "responsible_user_id = ?",
      ];
      const params = [
        String(name).trim(),
        location ? String(location).trim() : null,
        warehouseCode ? String(warehouseCode).trim() : null,
        warehouseType === "vehicle" ? "vehicle" : "store",
        warehouseType === "vehicle" ? String(vehicleNumber || "").trim() : null,
        responsibleUserId ? Number(responsibleUserId) : null,
      ];
      if (typeof stockCount === "number") {
        setCols.push("stock_count = ?");
        params.push(Number(stockCount) || 0);
      }
      if (typeof itemCount === "number") {
        setCols.push("item_count = ?");
        params.push(Number(itemCount) || 0);
      }
      params.push(warehouseId);

      const sqlUpdateWarehouse = `UPDATE warehouses SET ${setCols.join(
        ", ",
      )} WHERE id = ?`;
      connection.query(sqlUpdateWarehouse, params, (err, uRes) => {
        if (err)
          return rollbackWith(500, { ok: false, message: "Server error" });
        if (uRes.affectedRows === 0) {
          return rollbackWith(404, {
            ok: false,
            message: "Warehouse not found",
          });
        }

        // 2) Delete explicit cells (if any)
        const deleteSomeCells = (next) => {
          if (!deletedCellIds.length) return next();
          const sql = `
          DELETE c FROM cells c
          JOIN racks r ON r.id = c.rack_id
          JOIN zones z ON z.id = r.zone_id
          WHERE c.id IN (${placeholders(deletedCellIds)}) AND z.warehouse_id = ?
        `;
          connection.query(sql, [...deletedCellIds, warehouseId], (err) => {
            if (err) return next(err);
            next();
          });
        };

        // 3) Delete explicit racks (if any) — cells under these racks will be removed via FK if defined, but we scope anyway
        const deleteSomeRacks = (next) => {
          if (!deletedRackIds.length) return next();
          const sql = `
          DELETE r FROM racks r
          JOIN zones z ON z.id = r.zone_id
          WHERE r.id IN (${placeholders(deletedRackIds)}) AND z.warehouse_id = ?
        `;
          connection.query(sql, [...deletedRackIds, warehouseId], (err) => {
            if (err) return next(err);
            next();
          });
        };

        // 4) Delete explicit zones (if any) — cascades to racks/cells via FK if configured
        const deleteSomeZones = (next) => {
          if (!deletedZoneIds.length) return next();
          const sql = `
          DELETE FROM zones
          WHERE id IN (${placeholders(deletedZoneIds)}) AND warehouse_id = ?
        `;
          connection.query(sql, [...deletedZoneIds, warehouseId], (err) => {
            if (err) return next(err);
            next();
          });
        };

        // 5) Upsert zones → racks → cells
        const zonesArr = Array.isArray(zones) ? zones : [];

        const upsertCellsForRack = (rackId, cellsArr, cIdx, done) => {
          if (!Array.isArray(cellsArr) || cIdx >= cellsArr.length)
            return done(null);

          const raw = cellsArr[cIdx] || {};
          const cId = raw.id ? Number(raw.id) : null;
          const cName = raw.name && String(raw.name).trim();

          const nextCell = (err) => {
            if (err) return done(err);
            upsertCellsForRack(rackId, cellsArr, cIdx + 1, done);
          };

          if (!cName) return nextCell(); // skip empty

          if (cId) {
            const sql = `UPDATE cells SET name = ? WHERE id = ? AND rack_id = ?`;
            connection.query(sql, [cName, cId, rackId], (err) => nextCell(err));
          } else {
            const sql = `INSERT INTO cells (rack_id, name) VALUES (?, ?)`;
            connection.query(sql, [rackId, cName], (err) => nextCell(err));
          }
        };

        const upsertRacksForZone = (zoneId, racksArr, rIdx, done) => {
          if (!Array.isArray(racksArr) || rIdx >= racksArr.length)
            return done(null);

          const raw = racksArr[rIdx] || {};
          const rId = raw.id ? Number(raw.id) : null;
          const rName = raw.name && String(raw.name).trim();
          const cellsArr = Array.isArray(raw.cells) ? raw.cells : [];

          const nextRack = (err) => {
            if (err) return done(err);
            upsertRacksForZone(zoneId, racksArr, rIdx + 1, done);
          };

          if (!rName) return nextRack(); // skip empty

          if (rId) {
            // UPDATE rack and then upsert its cells
            const sql = `UPDATE racks SET name = ? WHERE id = ? AND zone_id = ?`;
            connection.query(sql, [rName, rId, zoneId], (err) => {
              if (err) return nextRack(err);
              upsertCellsForRack(rId, cellsArr, 0, nextRack);
            });
          } else {
            // INSERT rack then insert/update cells
            const sql = `INSERT INTO racks (zone_id, name) VALUES (?, ?)`;
            connection.query(sql, [zoneId, rName], (err, rRes) => {
              if (err) return nextRack(err);
              const newRackId = rRes.insertId;
              upsertCellsForRack(newRackId, cellsArr, 0, nextRack);
            });
          }
        };

        const upsertNextZone = (zIdx, doneAll) => {
          if (zIdx >= zonesArr.length) return doneAll(null);

          const z = zonesArr[zIdx] || {};
          const zId = z.id ? Number(z.id) : null;
          const zName = z.name && String(z.name).trim();
          const racksArr = Array.isArray(z.racks) ? z.racks : [];

          const nextZone = (err) => {
            if (err) return doneAll(err);
            upsertNextZone(zIdx + 1, doneAll);
          };

          if (!zName) return nextZone(); // skip empty zone

          if (zId) {
            const sql = `UPDATE zones SET name = ? WHERE id = ? AND warehouse_id = ?`;
            connection.query(sql, [zName, zId, warehouseId], (err) => {
              if (err) return nextZone(err);
              upsertRacksForZone(zId, racksArr, 0, nextZone);
            });
          } else {
            const sql = `INSERT INTO zones (warehouse_id, name) VALUES (?, ?)`;
            connection.query(sql, [warehouseId, zName], (err, zRes) => {
              if (err) return nextZone(err);
              const newZoneId = zRes.insertId;
              upsertRacksForZone(newZoneId, racksArr, 0, nextZone);
            });
          }
        };

        // 6) Read updated structure -> write audit log -> commit -> respond
        const readAndRespond = () => {
          const sqlW = `
          SELECT id, branch_id, name, location, warehouse_code, warehouse_type, vehicle_number, responsible_user_id, stock_count, item_count, created_by
          FROM warehouses WHERE id = ? LIMIT 1
        `;
          connection.query(sqlW, [warehouseId], (err, wRows) => {
            if (err)
              return rollbackWith(500, { ok: false, message: "Server error" });
            if (!wRows || !wRows.length)
              return rollbackWith(404, {
                ok: false,
                message: "Warehouse not found",
              });

            const w = wRows[0];
            const sqlZ = `SELECT id, name FROM zones WHERE warehouse_id = ? ORDER BY id`;
            connection.query(sqlZ, [warehouseId], (err, zRows) => {
              if (err)
                return rollbackWith(500, {
                  ok: false,
                  message: "Server error",
                });

              const zoneIds = (zRows || []).map((z) => z.id);
              if (zoneIds.length === 0) {
                return writeAuditLogThenCommit(
                  {
                    id: w.id,
                    branch_id: w.branch_id,
                    name: w.name,
                    location: w.location,
                    warehouse_code: w.warehouse_code,
                    stock_count: w.stock_count,
                    item_count: w.item_count,
                    created_by: w.created_by,
                    zones: [],
                  },
                  w.branch_id,
                );
              }

              const sqlR = `
              SELECT id, zone_id, name
              FROM racks
              WHERE zone_id IN (${placeholders(zoneIds)})
              ORDER BY id
            `;
              connection.query(sqlR, zoneIds, (err, rRows) => {
                if (err)
                  return rollbackWith(500, {
                    ok: false,
                    message: "Server error",
                  });

                const racksByZone = {};
                const rackIds = [];
                (rRows || []).forEach((r) => {
                  racksByZone[r.zone_id] = racksByZone[r.zone_id] || [];
                  racksByZone[r.zone_id].push({
                    id: r.id,
                    name: r.name,
                    cells: [],
                  });
                  rackIds.push(r.id);
                });

                if (rackIds.length === 0) {
                  const zonesOut = (zRows || []).map((z) => ({
                    id: z.id,
                    name: z.name,
                    racks: racksByZone[z.id] || [],
                  }));
                  return writeAuditLogThenCommit(
                    {
                      id: w.id,
                      branch_id: w.branch_id,
                      name: w.name,
                      location: w.location,
                      warehouse_code: w.warehouse_code,
                      warehouse_type: w.warehouse_type,
                      vehicle_number: w.vehicle_number,
                      responsible_user_id: w.responsible_user_id,
                      stock_count: w.stock_count,
                      item_count: w.item_count,
                      created_by: w.created_by,
                      zones: zonesOut,
                    },
                    w.branch_id,
                  );
                }

                const sqlC = `
                SELECT id, rack_id, name
                FROM cells
                WHERE rack_id IN (${placeholders(rackIds)})
                ORDER BY id
              `;
                connection.query(sqlC, rackIds, (err, cRows) => {
                  if (err)
                    return rollbackWith(500, {
                      ok: false,
                      message: "Server error",
                    });

                  const cellsByRack = {};
                  (cRows || []).forEach((c) => {
                    cellsByRack[c.rack_id] = cellsByRack[c.rack_id] || [];
                    cellsByRack[c.rack_id].push({ id: c.id, name: c.name });
                  });

                  // Attach cells to racks
                  Object.keys(racksByZone).forEach((zid) => {
                    racksByZone[zid] = (racksByZone[zid] || []).map((r) => ({
                      ...r,
                      cells: cellsByRack[r.id] || [],
                    }));
                  });

                  const zonesOut = (zRows || []).map((z) => ({
                    id: z.id,
                    name: z.name,
                    racks: racksByZone[z.id] || [],
                  }));

                  writeAuditLogThenCommit(
                    {
                      id: w.id,
                      branch_id: w.branch_id,
                      name: w.name,
                      location: w.location,
                      warehouse_code: w.warehouse_code,
                      warehouse_type: w.warehouse_type,
                      vehicle_number: w.vehicle_number,
                      responsible_user_id: w.responsible_user_id,
                      stock_count: w.stock_count,
                      item_count: w.item_count,
                      created_by: w.created_by,
                      zones: zonesOut,
                    },
                    w.branch_id,
                  );
                });
              });
            });
          });
        };

        const writeAuditLogThenCommit = (warehouseOut, branchIdForLog) => {
          const ip =
            (req.headers["x-forwarded-for"] &&
              req.headers["x-forwarded-for"].split(",")[0].trim()) ||
            req.socket?.remoteAddress ||
            req.ip ||
            null;
          const ua = req.headers["user-agent"] || null;

          const details = {
            name: warehouseOut.name,
            location: warehouseOut.location,
            warehouseCode: warehouseOut.warehouse_code,
            stockCount: warehouseOut.stock_count,
            itemCount: warehouseOut.item_count,
            zones: warehouseOut.zones.map((z) => ({
              id: z.id,
              name: z.name,
              racks: (z.racks || []).map((r) => ({
                id: r.id,
                name: r.name,
                cells: (r.cells || []).map((c) => ({ id: c.id, name: c.name })),
              })),
            })),
            request: {
              deletedZoneIds,
              deletedRackIds,
              deletedCellIds,
              setStockCount: typeof stockCount === "number",
              setItemCount: typeof itemCount === "number",
            },
          };

          const sqlLog = `
          INSERT INTO warehouse_audit_logs
            (warehouse_id, branch_id, actor_user_id, action, details, ip_address, user_agent)
          VALUES (?, ?, ?, 'UPDATE', ?, ?, ?)
        `;
          const paramsLog = [
            warehouseId,
            branchIdForLog || null,
            actorUserId,
            JSON.stringify(details || null),
            ip,
            ua,
          ];

          connection.query(sqlLog, paramsLog, (err) => {
            if (err) {
              console.error("audit log insert error:", err);
              return rollbackWith(500, { ok: false, message: "Server error" });
            }

            connection.commit((err) => {
              if (err) {
                console.error("commit error:", err);
                return rollbackWith(500, {
                  ok: false,
                  message: "Server error",
                });
              }

              // Log to Recent Activity
              connection.release();
              userLogDbService
                .insertLog(
                  actorUserId,
                  new Date(),
                  "edited",
                  warehouseId,
                  "Warehouse",
                  branchIdForLog,
                )
                .catch((err) =>
                  console.error("Recent Activity Log Error:", err),
                );

              return res.status(200).json({
                ok: true,
                message: "Warehouse updated successfully",
                warehouse: warehouseOut,
              });
            });
          });
        };

        // Chain: deletes → upserts → read+respond
        deleteSomeCells((err) => {
          if (err)
            return rollbackWith(500, { ok: false, message: "Server error" });
          deleteSomeRacks((err) => {
            if (err)
              return rollbackWith(500, { ok: false, message: "Server error" });
            deleteSomeZones((err) => {
              if (err)
                return rollbackWith(500, {
                  ok: false,
                  message: "Server error",
                });
              upsertNextZone(0, (err) => {
                if (err)
                  return rollbackWith(500, {
                    ok: false,
                    message: "Server error",
                  });
                readAndRespond();
              });
            });
          });
        });
      });

      function rollbackWith(statusCode, payload) {
        connection.rollback(() => {
          connection.release();
          res.status(statusCode).json(payload);
        });
      }
    });
  });
};

exports.deleteWarehouse = (req, res) => {
  const warehouseId = Number(req.params.id || req.body.id);
  if (!warehouseId) {
    return res.status(400).json({ ok: false, message: "id is required" });
  }

  conn.getConnection((err, connection) => {
    if (err) {
      console.error("getConnection error:", err);
      return res.status(500).json({ ok: false, message: "Server error" });
    }

    connection.beginTransaction((err) => {
      if (err) {
        connection.release();
        console.error("beginTransaction error:", err);
        return res.status(500).json({ ok: false, message: "Server error" });
      }

      // (A) Ensure the warehouse exists
      const sqlCheck = "SELECT id FROM warehouses WHERE id = ? LIMIT 1";
      connection.query(sqlCheck, [warehouseId], (err, rows) => {
        if (err)
          return rollbackWith(500, { ok: false, message: "Server error" });
        if (!rows || rows.length === 0) {
          return rollbackWith(404, {
            ok: false,
            message: "Warehouse not found",
          });
        }

        // (B) Delete racks under this warehouse (via join)
        const sqlDeleteRacks = `
        DELETE r FROM racks r
        JOIN zones z ON z.id = r.zone_id
        WHERE z.warehouse_id = ?
      `;
        connection.query(sqlDeleteRacks, [warehouseId], (err) => {
          if (err)
            return rollbackWith(500, { ok: false, message: "Server error" });

          // (C) Delete zones under this warehouse
          const sqlDeleteZones = `DELETE FROM zones WHERE warehouse_id = ?`;
          connection.query(sqlDeleteZones, [warehouseId], (err) => {
            if (err)
              return rollbackWith(500, { ok: false, message: "Server error" });

            // (D) Delete the warehouse itself
            const sqlDeleteWarehouse = `DELETE FROM warehouses WHERE id = ?`;
            connection.query(
              sqlDeleteWarehouse,
              [warehouseId],
              (err, delRes) => {
                if (err) {
                  // If you have FK references elsewhere not handled above, this will catch it
                  return rollbackWith(500, {
                    ok: false,
                    message: "Cannot delete warehouse (referenced elsewhere)",
                  });
                }
                if (delRes.affectedRows === 0) {
                  return rollbackWith(404, {
                    ok: false,
                    message: "Warehouse not found",
                  });
                }

                // (E) Commit
                connection.commit((err) => {
                  if (err) {
                    console.error("commit error:", err);
                    return rollbackWith(500, {
                      ok: false,
                      message: "Server error",
                    });
                  }
                  connection.release();
                  return res.json({ ok: true, id: warehouseId });
                });
              },
            );
          });
        });
      });

      function rollbackWith(statusCode, payload) {
        connection.rollback(() => {
          connection.release();
          res.status(statusCode).json(payload);
        });
      }
    });
  });
};

function safeParseJSON(maybeJSON) {
  if (maybeJSON == null) return null;
  try {
    if (typeof maybeJSON === "object") return maybeJSON; // already parsed by driver
    return JSON.parse(maybeJSON);
  } catch {
    return null;
  }
}

/**
 * Helper to enrich log items with item Descriptions if they are missing names.
 */
const enrichWarehouseLogs = (logs, callback) => {
  const itemIdsToLookup = new Set();
  logs.forEach((log) => {
    if (log.details && Array.isArray(log.details.items)) {
      log.details.items.forEach((it) => {
        const itemId = it.itemId || it.id;
        if (itemId && (!it.name || it.name === "Product")) {
          itemIdsToLookup.add(Number(itemId));
        }
      });
    }
  });

  if (itemIdsToLookup.size === 0) {
    return callback(null, logs);
  }

  const idsArray = Array.from(itemIdsToLookup);
  conn.query(
    "SELECT idItem, Description FROM item WHERE idItem IN (?)",
    [idsArray],
    (errItem, itemRows) => {
      if (errItem) {
        console.error("enrichWarehouseLogs item lookup error:", errItem);
        return callback(errItem, logs);
      }

      const nameMap = {};
      (itemRows || []).forEach((row) => {
        nameMap[row.idItem] = row.Description;
      });

      logs.forEach((log) => {
        if (log.details && Array.isArray(log.details.items)) {
          log.details.items.forEach((it) => {
            const itemId = it.itemId || it.id;
            if (itemId && (!it.name || it.name === "Product") && nameMap[itemId]) {
              it.name = nameMap[itemId];
            }
          });
        }
      });

      callback(null, logs);
    }
  );
};

/**
 * GET /api/warehouses/:id/logs?limit=50&offset=0&branchId=
 * Return logs for a specific warehouse strictly filtered by warehouseId and branchId.
 */
exports.getWarehouseLogs = (req, res) => {
  const warehouseId = Number(req.params.id);
  const branchId = req.query.branchId ? Number(req.query.branchId) : null;
  const limit = Math.max(1, Math.min(500, Number(req.query.limit || 50)));
  const offset = Math.max(0, Number(req.query.offset || 0));

  if (!warehouseId) {
    return res.status(400).json({ ok: false, message: "id is required" });
  }

  // Verify warehouse exists and matches the requesting branch
  const checkSql = "SELECT id, branch_id FROM warehouses WHERE id = ?";
  conn.query(checkSql, [warehouseId], (errCheck, whRows) => {
    if (errCheck) {
      console.error("getWarehouseLogs check error:", errCheck);
      return res.status(500).json({ ok: false, message: "Server error" });
    }
    if (!whRows || whRows.length === 0) {
      return res.status(404).json({ ok: false, message: "Warehouse not found" });
    }

    const warehouse = whRows[0];
    if (branchId && Number(warehouse.branch_id) !== Number(branchId)) {
      return res.status(403).json({
        ok: false,
        message: "Unauthorized: Warehouse does not belong to this branch",
      });
    }

    const effectiveBranchId = branchId || warehouse.branch_id;

    const sql = `
      SELECT l.id, l.warehouse_id, l.branch_id, l.actor_user_id, l.action, l.details,
             l.ip_address, l.user_agent, l.created_at, CONCAT(u.First_Name, ' ', u.Last_Name) as actor_name
      FROM warehouse_audit_logs l
      LEFT JOIN asipbook_account_center.asipiya_user u ON u.idAsipiya_User = l.actor_user_id
      WHERE l.warehouse_id = ? AND l.branch_id = ?
      ORDER BY l.id DESC
      LIMIT ? OFFSET ?
    `;

    conn.query(sql, [warehouseId, effectiveBranchId, limit, offset], (err, rows) => {
      if (err) {
        console.error("getWarehouseLogs error:", err);
        return res.status(500).json({ ok: false, message: "Server error" });
      }
      const logs = (rows || []).map((r) => ({
        id: r.id,
        warehouse_id: r.warehouse_id,
        branch_id: r.branch_id,
        actor_user_id: r.actor_user_id,
        actor_name: r.actor_name,
        action: r.action,
        details: safeParseJSON(r.details),
        ip_address: r.ip_address,
        user_agent: r.user_agent,
        created_at: r.created_at,
      }));

      enrichWarehouseLogs(logs, (errEnrich, enrichedLogs) => {
        return res.json({ ok: true, logs: enrichedLogs });
      });
    });
  });
};

/**
 * GET /api/warehouses/logs?branchId=&limit=100&offset=0
 * Return logs for all warehouses strictly filtered by branchId.
 */
exports.getAllWarehouseLogs = (req, res) => {
  const branchId = req.query.branchId ? Number(req.query.branchId) : null;
  const limit = Math.max(1, Math.min(500, Number(req.query.limit || 100)));
  const offset = Math.max(0, Number(req.query.offset || 0));

  if (!branchId) {
    return res
      .status(400)
      .json({ ok: false, message: "branchId is required to view warehouse logs" });
  }

  const sql = `
    SELECT l.id, l.warehouse_id, l.branch_id, l.actor_user_id, l.action, l.details,
           l.ip_address, l.user_agent, l.created_at, CONCAT(u.First_Name, ' ', u.Last_Name) as actor_name
    FROM warehouse_audit_logs l
    INNER JOIN warehouses w ON w.id = l.warehouse_id
    LEFT JOIN asipbook_account_center.asipiya_user u ON u.idAsipiya_User = l.actor_user_id
    WHERE l.branch_id = ? AND w.branch_id = ?
    ORDER BY l.id DESC
    LIMIT ? OFFSET ?
  `;

  conn.query(sql, [branchId, branchId, limit, offset], (err, rows) => {
    if (err) {
      console.error("getAllWarehouseLogs error:", err);
      return res.status(500).json({ ok: false, message: "Server error" });
    }
    const logs = (rows || []).map((r) => ({
      id: r.id,
      warehouse_id: r.warehouse_id,
      branch_id: r.branch_id,
      actor_user_id: r.actor_user_id,
      actor_name: r.actor_name,
      action: r.action,
      details: safeParseJSON(r.details),
      ip_address: r.ip_address,
      user_agent: r.user_agent,
      created_at: r.created_at,
    }));

    enrichWarehouseLogs(logs, (errEnrich, enrichedLogs) => {
      return res.json({ ok: true, logs: enrichedLogs });
    });
  });
};

// GET /api/warehouses/company-staff/:companyId
// Staff live in asipbook_account_center.asipiya_user (db2), mapped to companies
// via company_has_asipiya_user — the local asipiya_test.user table is unused.
exports.getCompanyStaff = async (req, res) => {
  const companyId = Number(req.params.companyId);
  if (!companyId) {
    return res
      .status(400)
      .json({ ok: false, message: "companyId is required and must be a number" });
  }

  try {
    const [rows] = await db2.promise().query(
      `SELECT au.idAsipiya_User AS id,
              COALESCE(NULLIF(TRIM(CONCAT(COALESCE(au.First_Name, ''), ' ', COALESCE(au.Last_Name, ''))), ''), au.Email) AS name,
              au.Contact_No_01 AS phone,
              au.Email AS email,
              chau.Role AS role
       FROM asipiya_user au
       JOIN company_has_asipiya_user chau
         ON au.idAsipiya_User = chau.Asipiya_User_idAsipiya_User
       WHERE chau.Company_idCompany = ? AND au.Status = '1'
       ORDER BY au.First_Name ASC, au.Last_Name ASC`,
      [companyId],
    );

    return res.json({ ok: true, staff: rows || [] });
  } catch (err) {
    console.error("getCompanyStaff error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
};

// GET /api/warehouses?branchId=#
exports.getWarehousesByBranch = (req, res) => {
  const branchId = Number(req.query.branchId);
  if (!branchId) {
    return res
      .status(400)
      .json({ message: "branchId is required and must be a number" });
  }

  const sql = `
    SELECT id, branch_id, name, location, warehouse_code, warehouse_type, vehicle_number, responsible_user_id, stock_count, item_count
    FROM warehouses
    WHERE branch_id = ?
    ORDER BY name ASC
  `;

  conn.query(sql, [branchId], (err, rows) => {
    if (err) {
      console.error("getWarehousesByBranch error:", err);
      return res.status(500).json({ message: "Failed to fetch warehouses" });
    }
    return res.json(rows);
  });
};

// GET /api/warehouses/:warehouseId/zones
exports.getZonesByWarehouse = (req, res) => {
  const warehouseId = Number(req.params.warehouseId);
  if (!warehouseId) {
    return res.status(400).json({ message: "warehouseId must be a number" });
  }

  const sql = `
    SELECT id, warehouse_id, name
    FROM zones
    WHERE warehouse_id = ?
    ORDER BY name ASC
  `;

  conn.query(sql, [warehouseId], (err, rows) => {
    if (err) {
      console.error("getZonesByWarehouse error:", err);
      return res.status(500).json({ message: "Failed to fetch zones" });
    }
    return res.json(rows);
  });
};

// GET /api/zones/:zoneId/racks
exports.getRacksByZone = (req, res) => {
  const zoneId = Number(req.params.zoneId);
  if (!zoneId) {
    return res.status(400).json({ message: "zoneId must be a number" });
  }

  const sql = `
    SELECT id, zone_id, name
    FROM racks
    WHERE zone_id = ?
    ORDER BY name ASC
  `;

  conn.query(sql, [zoneId], (err, rows) => {
    if (err) {
      console.error("getRacksByZone error:", err);
      return res.status(500).json({ message: "Failed to fetch racks" });
    }
    return res.json(rows);
  });
};

// GET /api/racks/:rackId/cells
exports.getCellsByRack = (req, res) => {
  const rackId = Number(req.params.rackId);
  if (!rackId) {
    return res.status(400).json({ message: "rackId must be a number" });
  }

  const sql = `
    SELECT id, rack_id, name
    FROM cells
    WHERE rack_id = ?
    ORDER BY name ASC
  `;

  conn.query(sql, [rackId], (err, rows) => {
    if (err) {
      console.error("getCellsByRack error:", err);
      return res.status(500).json({ message: "Failed to fetch cells" });
    }
    return res.json(rows);
  });
};

exports.getWarehouseItems = (req, res) => {
  const warehouseId = parseInt(req.params.warehouseId, 10);
  if (!warehouseId) {
    return res
      .status(400)
      .json({ ok: false, message: "Invalid warehouse id." });
  }

  const sql = `
    SELECT
      ib.batch_id                                      AS id,
      ib.item_id                                       AS itemId,
      ib.variation_id                                  AS variationId,
      COALESCE(iv.item_code, i.Item_Code)              AS sku,
      CASE
        WHEN iv.id IS NOT NULL AND iv.description IS NOT NULL AND iv.description != ''
          THEN CONCAT(i.Description, ' (', iv.description, ')')
        WHEN iv.id IS NOT NULL AND iv.item_code IS NOT NULL AND iv.item_code != ''
          THEN CONCAT(i.Description, ' (', iv.item_code, ')')
        ELSE i.Description
      END                                              AS name,
      COALESCE(NULLIF(TRIM(iv.barcode), ''), NULLIF(TRIM(i.barcode), '')) AS barcode,
      pb.extra_barcodes                                AS extra_barcodes,
      COALESCE(NULLIF(TRIM(z.name), ''), w.name)       AS zone_name,
      COALESCE(NULLIF(TRIM(r.name), ''), w.name)       AS rack_name,
      ib.qty                                           AS quantity,
      COALESCE(qt.Description, '')                     AS uom,
      COALESCE(ib.cost, iv.cost, i.Cost, 0)            AS cost,
      ib.total_cost                                    AS total_cost,
      ib.warehouse_id                                  AS warehouse_id
    FROM item_batch ib
    INNER JOIN item i
      ON i.idItem = ib.item_id
    LEFT JOIN item_variations iv
      ON iv.id = ib.variation_id
    LEFT JOIN (
      SELECT item_id, GROUP_CONCAT(DISTINCT barcode SEPARATOR ', ') AS extra_barcodes
      FROM product_barcodes
      GROUP BY item_id
    ) pb ON pb.item_id = i.idItem
    LEFT JOIN zones z
      ON z.id = ib.warehouse_zone
    LEFT JOIN racks r
      ON r.id = ib.warehouse_rack_id
    LEFT JOIN quantity_type qt
      ON qt.idQuantity_Type = i.Qty_Type
    INNER JOIN warehouses w
      ON w.id = ib.warehouse_id
    LEFT JOIN grn g
      ON g.idGRN = ib.grn_id
    WHERE ib.warehouse_id = ? 
      AND ib.qty > 0 
      AND i.Status = 1
      AND (ib.grn_id IS NULL OR ib.grn_id = 0 OR g.Status = 1 OR g.Status = '1')
    ORDER BY i.Description ASC, ib.batch_id DESC
  `;

  conn.query(sql, [warehouseId], (err, rows) => {
    if (err) {
      console.error("getWarehouseItems error:", err);
      return res.status(500).json({
        ok: false,
        message: "Database error while fetching warehouse items.",
      });
    }
    return res.json({ ok: true, items: rows || [] });
  });
};

/**
 * POST /api/stock-transfers
 * Transfer stock from one warehouse (source) to another (target).
 */
exports.transferStock = async (req, res) => {
  const {
    sourceWarehouseId,
    targetWarehouseId,
    userId,
    items, // [{ itemId, quantity, sourceBatchId, targetZoneId, targetRackId, targetCellId, name }]
    date, // optional
  } = req.body || {};

  // 1. Basic Validation
  const errors = {};
  if (!sourceWarehouseId)
    errors.sourceWarehouseId = "Source Warehouse is required";
  if (!targetWarehouseId)
    errors.targetWarehouseId = "Target Warehouse is required";
  if (Number(sourceWarehouseId) === Number(targetWarehouseId))
    errors.targetWarehouseId = "Target must be different from Source";
  if (!items || !Array.isArray(items) || items.length === 0)
    errors.items = "Items list is required";

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ ok: false, errors });
  }

  // 2. Transaction
  conn.getConnection(async (err, connection) => {
    if (err) {
      console.error("getConnection error:", err);
      return res.status(500).json({ ok: false, message: "Database connection error" });
    }

    const queryAsync = (sql, params = []) =>
      new Promise((resolve, reject) => {
        connection.query(sql, params, (e, results) => {
          if (e) reject(e);
          else resolve(results);
        });
      });

    const rollbackWith = (status, body) => {
      connection.rollback(() => {
        connection.release();
        res.status(status).json(body);
      });
    };

    try {
      await new Promise((resolve, reject) => {
        connection.beginTransaction((e) => (e ? reject(e) : resolve()));
      });

      // 3. Verify Warehouses
      const whRows = await queryAsync(
        "SELECT id, branch_id, name, warehouse_type, vehicle_number, responsible_user_id FROM warehouses WHERE id IN (?, ?)",
        [sourceWarehouseId, targetWarehouseId]
      );
      const sourceWh = whRows.find((w) => w.id === Number(sourceWarehouseId));
      const targetWh = whRows.find((w) => w.id === Number(targetWarehouseId));

      if (!sourceWh) {
        return rollbackWith(404, { ok: false, message: "Source Warehouse not found" });
      }
      if (!targetWh) {
        return rollbackWith(404, { ok: false, message: "Target Warehouse not found" });
      }

      // 3b. Resolve responsible-person details for source/target custodians
      const custodianUserIds = [
        ...new Set(
          [sourceWh.responsible_user_id, targetWh.responsible_user_id].filter(Boolean)
        ),
      ];
      let custodianMap = {};
      if (custodianUserIds.length > 0) {
        const [custodianRows] = await db2.promise().query(
          `SELECT idAsipiya_User, First_Name, Last_Name, Contact_No_01
           FROM asipiya_user
           WHERE idAsipiya_User IN (${custodianUserIds.map(() => "?").join(",")})`,
          custodianUserIds
        );
        (custodianRows || []).forEach((u) => {
          custodianMap[u.idAsipiya_User] = u;
        });
      }
      const custodianOf = (wh) => {
        const u = custodianMap[wh.responsible_user_id];
        return {
          name: u ? `${u.First_Name || ""} ${u.Last_Name || ""}`.trim() : null,
          phone: u ? u.Contact_No_01 || null : null,
        };
      };

      // 4. Verify Company Isolation and Fetch Branch Metadata from DB2
      const [branchesDb2] = await db2.promise().query(
        "SELECT idBranch, Name, Company_idCompany FROM branch WHERE idBranch IN (?, ?)",
        [sourceWh.branch_id, targetWh.branch_id]
      );
      const sourceBranch = branchesDb2.find((b) => b.idBranch === Number(sourceWh.branch_id));
      const targetBranch = branchesDb2.find((b) => b.idBranch === Number(targetWh.branch_id));

      if (!sourceBranch || !targetBranch || Number(sourceBranch.Company_idCompany) !== Number(targetBranch.Company_idCompany)) {
        return rollbackWith(400, {
          ok: false,
          message: "Cross-company stock transfers are not permitted.",
        });
      }

      const isCrossBranch = Number(sourceWh.branch_id) !== Number(targetWh.branch_id);
      const companyId = sourceBranch.Company_idCompany;
      const sourceBranchName = sourceBranch.Name;
      const targetBranchName = targetBranch.Name;

      // 5. Process Items
      const processedItems = [];

      for (let i = 0; i < items.length; i++) {
        const itemReq = items[i];
        const qtyToMove = Number(itemReq.quantity);
        const reqSourceBatchId = itemReq.sourceBatchId ? Number(itemReq.sourceBatchId) : null;

        if (!qtyToMove || qtyToMove <= 0) {
          return rollbackWith(400, {
            ok: false,
            message: `Invalid quantity for item ${itemReq.itemId || itemReq.name}`,
          });
        }

        // Determine batches to draw from
        let batchesToUse = [];

        if (reqSourceBatchId) {
          batchesToUse.push({ batchId: reqSourceBatchId, moveQty: qtyToMove });
        } else {
          // Auto-resolution (FIFO)
          let availableBatches = await queryAsync(
            `SELECT ib.batch_id, ib.qty 
             FROM item_batch ib
             LEFT JOIN grn g ON ib.grn_id = g.idGRN
             WHERE ib.item_id = ? 
               AND ib.warehouse_id = ? 
               AND ib.qty > 0
               AND (ib.grn_id IS NULL OR ib.grn_id = 0 OR g.Status = 1 OR g.Status = '1')
             ORDER BY ib.expiry_date ASC, ib.batch_id ASC
             FOR UPDATE`,
            [itemReq.itemId, sourceWarehouseId]
          );

          // If no batches found by item_id, check if itemReq.itemId is actually a batch_id
          if (!availableBatches || availableBatches.length === 0) {
            const batchRows = await queryAsync(
              `SELECT ib.* 
               FROM item_batch ib
               LEFT JOIN grn g ON ib.grn_id = g.idGRN
               WHERE ib.batch_id = ? 
                 AND ib.warehouse_id = ? 
                 AND ib.qty > 0
                 AND (ib.grn_id IS NULL OR ib.grn_id = 0 OR g.Status = 1 OR g.Status = '1')
               FOR UPDATE`,
              [itemReq.itemId, sourceWarehouseId]
            );
            if (batchRows && batchRows.length > 0) {
              availableBatches = batchRows;
            } else {
              return rollbackWith(400, {
                ok: false,
                message: `Insufficient stock for item "${itemReq.name || itemReq.itemId}". Found 0 available in source warehouse.`,
              });
            }
          }

          let remaining = qtyToMove;
          for (const b of availableBatches) {
            if (remaining <= 0) break;
            const take = Math.min(remaining, Number(b.qty));
            batchesToUse.push({ batchId: b.batch_id, moveQty: take });
            remaining -= take;
          }

          if (remaining > 0) {
            return rollbackWith(400, {
              ok: false,
              message: `Insufficient stock for item "${itemReq.name || itemReq.itemId}". Needed ${qtyToMove}, only found ${qtyToMove - remaining}.`,
            });
          }
        }

        // Execute batch transfers
        for (const chunk of batchesToUse) {
          const { batchId, moveQty } = chunk;

          // Lock source batch
          const bRows = await queryAsync(
            "SELECT * FROM item_batch WHERE batch_id = ? FOR UPDATE",
            [batchId]
          );
          if (!bRows || bRows.length === 0) {
            return rollbackWith(404, { ok: false, message: `Source batch ${batchId} not found.` });
          }

          const sourceBatch = bRows[0];
          if (sourceBatch.warehouse_id !== Number(sourceWarehouseId)) {
            return rollbackWith(400, {
              ok: false,
              message: `Batch ${batchId} does not belong to source warehouse ${sourceWh.name}.`,
            });
          }
          if (Number(sourceBatch.qty) < moveQty) {
            return rollbackWith(400, {
              ok: false,
              message: `Insufficient stock in batch ${batchId}. Available: ${sourceBatch.qty}, Requested: ${moveQty}`,
            });
          }

          // Fetch source item record
          const sItemRows = await queryAsync("SELECT * FROM item WHERE idItem = ?", [sourceBatch.item_id]);
          if (!sItemRows || sItemRows.length === 0) {
            return rollbackWith(404, { ok: false, message: `Source item ${sourceBatch.item_id} not found.` });
          }
          const sourceItem = sItemRows[0];

          // Deduct source batch
          await queryAsync("UPDATE item_batch SET qty = qty - ? WHERE batch_id = ?", [moveQty, batchId]);

          // Target Item and Variation resolution
          let targetItemId = sourceBatch.item_id;
          let targetVariationId = sourceBatch.variation_id;

          if (isCrossBranch) {
            // Deduct source branch item.Qty
            await queryAsync("UPDATE item SET Qty = Qty - ? WHERE idItem = ?", [moveQty, sourceBatch.item_id]);

            // Deduct source variation if present
            if (sourceBatch.variation_id) {
              await queryAsync("UPDATE item_variations SET qty = qty - ? WHERE id = ?", [moveQty, sourceBatch.variation_id]);
            }

            // Check if item exists in target branch
            const matchConditions = [];
            const matchParams = [targetWh.branch_id];
            if (sourceItem.Item_Code && sourceItem.Item_Code.trim()) {
              matchConditions.push("Item_Code = ?");
              matchParams.push(sourceItem.Item_Code.trim());
            }
            if (sourceItem.productSKU && sourceItem.productSKU.trim()) {
              matchConditions.push("productSKU = ?");
              matchParams.push(sourceItem.productSKU.trim());
            }
            if (sourceItem.barcode && sourceItem.barcode.trim()) {
              matchConditions.push("barcode = ?");
              matchParams.push(sourceItem.barcode.trim());
            }
            if (sourceItem.Description && sourceItem.Description.trim()) {
              matchConditions.push("Description = ?");
              matchParams.push(sourceItem.Description.trim());
            }

            const sqlMatch = matchConditions.length > 0
              ? `SELECT * FROM item WHERE Branch_idBranch = ? AND (${matchConditions.join(" OR ")}) LIMIT 1`
              : `SELECT * FROM item WHERE Branch_idBranch = ? AND Description = ? LIMIT 1`;

            const tItemRows = await queryAsync(sqlMatch, matchParams);

            if (tItemRows && tItemRows.length > 0) {
              // Existing item in target branch
              const targetItem = tItemRows[0];
              targetItemId = targetItem.idItem;

              // Increment target item.Qty
              await queryAsync("UPDATE item SET Qty = Qty + ? WHERE idItem = ?", [moveQty, targetItemId]);

              // Variation resolution in target branch
              if (sourceBatch.variation_id) {
                const sVarRows = await queryAsync("SELECT * FROM item_variations WHERE id = ?", [sourceBatch.variation_id]);
                if (sVarRows && sVarRows.length > 0) {
                  const sVar = sVarRows[0];
                  const tVarRows = await queryAsync(
                    `SELECT * FROM item_variations 
                     WHERE item_id = ? AND (
                       (item_code IS NOT NULL AND item_code != '' AND item_code = ?) OR
                       (product_sku IS NOT NULL AND product_sku != '' AND product_sku = ?) OR
                       (description = ?)
                     ) LIMIT 1`,
                    [targetItemId, sVar.item_code || "", sVar.product_sku || "", sVar.description || ""]
                  );

                  if (tVarRows && tVarRows.length > 0) {
                    targetVariationId = tVarRows[0].id;
                    await queryAsync("UPDATE item_variations SET qty = qty + ? WHERE id = ?", [moveQty, targetVariationId]);
                  } else {
                    const vCopy = { ...sVar };
                    delete vCopy.id;
                    delete vCopy.created_at;
                    delete vCopy.updated_at;
                    vCopy.item_id = targetItemId;
                    vCopy.qty = moveQty;
                    const vRes = await queryAsync("INSERT INTO item_variations SET ?", [vCopy]);
                    targetVariationId = vRes.insertId;
                  }
                }
              } else {
                targetVariationId = null;
              }
            } else {
              // Create / Clone item in target branch
              const itemCopy = { ...sourceItem };
              delete itemCopy.idItem;
              itemCopy.Branch_idBranch = targetWh.branch_id;
              itemCopy.Qty = moveQty;
              itemCopy.Cost = sourceBatch.cost !== undefined ? sourceBatch.cost : (sourceItem.Cost || 0);
              itemCopy.Real_Cost = sourceBatch.cost !== undefined ? sourceBatch.cost : (sourceItem.Real_Cost || 0);
              itemCopy.Rate = sourceBatch.rate !== undefined ? sourceBatch.rate : (sourceItem.Rate || 0);
              itemCopy.Status = 1;

              const insertItemRes = await queryAsync("INSERT INTO item SET ?", [itemCopy]);
              targetItemId = insertItemRes.insertId;

              // Clone variations
              const variations = await queryAsync("SELECT * FROM item_variations WHERE item_id = ?", [sourceBatch.item_id]);
              for (const v of variations) {
                const vCopy = { ...v };
                delete vCopy.id;
                delete vCopy.created_at;
                delete vCopy.updated_at;
                vCopy.item_id = targetItemId;
                if (v.id === sourceBatch.variation_id) {
                  vCopy.qty = moveQty;
                } else {
                  vCopy.qty = 0;
                }
                const varRes = await queryAsync("INSERT INTO item_variations SET ?", [vCopy]);
                if (v.id === sourceBatch.variation_id) {
                  targetVariationId = varRes.insertId;
                }
              }

              // Clone barcodes
              const barcodes = await queryAsync("SELECT * FROM product_barcodes WHERE item_id = ?", [sourceBatch.item_id]);
              for (const b of barcodes) {
                const bCopy = { ...b };
                delete bCopy.id;
                delete bCopy.created_at;
                bCopy.item_id = targetItemId;
                await queryAsync("INSERT INTO product_barcodes SET ?", [bCopy]);
              }

              // Clone images
              const images = await queryAsync("SELECT * FROM product_images WHERE item_id = ?", [sourceBatch.item_id]);
              for (const img of images) {
                const imgCopy = { ...img };
                delete imgCopy.id;
                imgCopy.item_id = targetItemId;
                await queryAsync("INSERT INTO product_images SET ?", [imgCopy]);
              }

              // Clone custom fields
              const fields = await queryAsync("SELECT * FROM product_field_data WHERE item_id = ?", [sourceBatch.item_id]);
              for (const f of fields) {
                const fCopy = { ...f };
                delete fCopy.id;
                delete fCopy.created_at;
                delete fCopy.updated_at;
                fCopy.item_id = targetItemId;
                await queryAsync("INSERT INTO product_field_data SET ?", [fCopy]);
              }
            }
          }

          // Target Batch Allocation
          const targetZone = itemReq.targetZoneId || null;
          const targetRack = itemReq.targetRackId || null;
          const targetCell = itemReq.targetCellId || null;

          const sqlFindTarget = `
            SELECT batch_id FROM item_batch
            WHERE item_id = ? AND warehouse_id = ?
              AND warehouse_zone <=> ? AND warehouse_rack_id <=> ? AND warehouse_rack_cell <=> ?
              AND batch_code <=> ? AND variation_id <=> ?
              AND cost = ? AND expiry_date <=> ?
            LIMIT 1
          `;
          const paramsFind = [
            targetItemId,
            targetWarehouseId,
            targetZone,
            targetRack,
            targetCell,
            sourceBatch.batch_code,
            targetVariationId,
            sourceBatch.cost,
            sourceBatch.expiry_date,
          ];
          const tRows = await queryAsync(sqlFindTarget, paramsFind);

          let targetBatchId;
          let merged = false;

          if (tRows.length > 0) {
            targetBatchId = tRows[0].batch_id;
            merged = true;
            await queryAsync("UPDATE item_batch SET qty = qty + ? WHERE batch_id = ?", [moveQty, targetBatchId]);
          } else {
            const newTotalCost = Number(sourceBatch.cost || 0) * moveQty;
            const sqlInsertBatch = `
              INSERT INTO item_batch
              (grn_id, item_id, warehouse_id, warehouse_zone, warehouse_rack_id, warehouse_rack_cell, qty, cost, rate, total_cost, updated_user_id, batch_code, variation_id, expiry_date)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            const insertBatchRes = await queryAsync(sqlInsertBatch, [
              sourceBatch.grn_id || null,
              targetItemId,
              targetWarehouseId,
              targetZone,
              targetRack,
              targetCell,
              moveQty,
              sourceBatch.cost || 0,
              sourceBatch.rate || 0,
              newTotalCost,
              userId || sourceBatch.updated_user_id || 1,
              sourceBatch.batch_code || null,
              targetVariationId,
              sourceBatch.expiry_date || null,
            ]);
            targetBatchId = insertBatchRes.insertId;
          }

          // Log Stock Card (Source Branch)
          await queryAsync(
            `INSERT INTO stock_card 
             (Date, Item_idItem, Description, Transaction_Type, Transaction_ID, Cost, Real_Cost, Sell_Price, IN_Stock, Out_Stock, Branch_idBranch, Variation_Id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              new Date(),
              sourceBatch.item_id,
              isCrossBranch ? `Inter-Branch Transfer Out to ${targetWh.name} (${targetBranchName})` : `Stock Transfer Out to ${targetWh.name}`,
              "TRANSFER_OUT",
              sourceWarehouseId,
              sourceBatch.cost || 0,
              sourceBatch.cost || 0,
              sourceBatch.rate || 0,
              0,
              moveQty,
              sourceWh.branch_id,
              sourceBatch.variation_id || null,
            ]
          );

          // Log Stock Card (Target Branch)
          await queryAsync(
            `INSERT INTO stock_card 
             (Date, Item_idItem, Description, Transaction_Type, Transaction_ID, Cost, Real_Cost, Sell_Price, IN_Stock, Out_Stock, Branch_idBranch, Variation_Id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              new Date(),
              targetItemId,
              isCrossBranch ? `Inter-Branch Transfer In from ${sourceWh.name} (${sourceBranchName})` : `Stock Transfer In from ${sourceWh.name}`,
              "TRANSFER_IN",
              targetWarehouseId,
              sourceBatch.cost || 0,
              sourceBatch.cost || 0,
              sourceBatch.rate || 0,
              moveQty,
              0,
              targetWh.branch_id,
              targetVariationId || null,
            ]
          );

          processedItems.push({
            itemId: itemReq.itemId,
            sourceItemId: sourceBatch.item_id,
            targetItemId,
            sourceVariationId: sourceBatch.variation_id,
            targetVariationId,
            status: "moved",
            newBatchId: targetBatchId,
            merged,
            name: itemReq.name || sourceItem.Description,
            quantity: moveQty,
          });
        }
      }

      // 6. Synchronize warehouse counters directly from item_batch
      const sqlSyncCounters = `
        UPDATE warehouses w
        SET 
          stock_count = COALESCE((SELECT SUM(ib.qty) FROM item_batch ib LEFT JOIN grn g ON ib.grn_id = g.idGRN WHERE ib.warehouse_id = w.id AND ib.qty > 0 AND (ib.grn_id IS NULL OR ib.grn_id = 0 OR g.Status = 1 OR g.Status = '1')), 0),
          item_count = COALESCE((SELECT COUNT(DISTINCT ib.item_id) FROM item_batch ib LEFT JOIN grn g ON ib.grn_id = g.idGRN WHERE ib.warehouse_id = w.id AND ib.qty > 0 AND (ib.grn_id IS NULL OR ib.grn_id = 0 OR g.Status = 1 OR g.Status = '1')), 0)
        WHERE w.id IN (?, ?)
      `;
      await queryAsync(sqlSyncCounters, [sourceWarehouseId, targetWarehouseId]);

      // 7. Audit Logging
      const details = {
        sourceWarehouseId,
        targetWarehouseId,
        sourceBranchId: sourceWh.branch_id,
        targetBranchId: targetWh.branch_id,
        sourceBranchName,
        targetBranchName,
        isCrossBranch,
        items: processedItems.map((i) => ({
          itemId: i.itemId,
          sourceItemId: i.sourceItemId,
          targetItemId: i.targetItemId,
          qty: i.quantity,
          name: i.name,
        })),
        date: date || new Date().toISOString(),
      };

      const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || null;
      const ua = req.headers["user-agent"] || null;

      await queryAsync(
        `INSERT INTO warehouse_audit_logs
         (warehouse_id, branch_id, actor_user_id, action, details, ip_address, user_agent)
         VALUES (?, ?, ?, 'UPDATE', ?, ?, ?)`,
        [sourceWarehouseId, sourceWh.branch_id, userId, JSON.stringify({ type: "TRANSFER_OUT", ...details }), ip, ua]
      );

      await queryAsync(
        `INSERT INTO warehouse_audit_logs
         (warehouse_id, branch_id, actor_user_id, action, details, ip_address, user_agent)
         VALUES (?, ?, ?, 'UPDATE', ?, ?, ?)`,
        [targetWarehouseId, targetWh.branch_id, userId, JSON.stringify({ type: "TRANSFER_IN", ...details }), ip, ua]
      );

      // 8. Commit Transaction
      await new Promise((resolve, reject) => {
        connection.commit((e) => (e ? reject(e) : resolve()));
      });

      connection.release();

      // 9. Post-Commit Asynchronous Activities (User Activity Log & Product History Log)
      userLogDbService
        .insertLog(
          userId,
          new Date(),
          "transferred",
          sourceWarehouseId,
          isCrossBranch ? `Inter-Branch Stock Transfer (${sourceBranchName} -> ${targetBranchName})` : "Stock Transfer",
          sourceWh.branch_id
        )
        .catch((err) => console.error("Recent Activity Log Error:", err));

      processedItems.forEach(async (p) => {
        try {
          if (!isCrossBranch) {
            // Intra-branch: Net item inventory change is 0
            conn.query(
              "SELECT Qty FROM item WHERE idItem = ?",
              [p.sourceItemId],
              async (err, itemRows) => {
                if (err || !itemRows || itemRows.length === 0) return;
                const currentQty = parseFloat(itemRows[0].Qty) || 0;
                await productHistoryLogHelper({
                  productId: p.sourceItemId,
                  variationId: p.sourceVariationId || null,
                  quantityChange: 0,
                  oldQty: currentQty,
                  newQty: currentQty,
                  type: "Warehouse Transfer",
                  description: `Transferred ${p.quantity} units of "${p.name || ''}" from Warehouse: "${sourceWh.name}" to Warehouse: "${targetWh.name}"`,
                  branchId: sourceWh.branch_id,
                  companyId: companyId,
                  userId: userId,
                  referenceId: targetWarehouseId,
                });
              }
            );
          } else {
            // Inter-branch: Source branch deducted
            conn.query(
              "SELECT Qty FROM item WHERE idItem = ?",
              [p.sourceItemId],
              async (err, itemRows) => {
                if (err || !itemRows || itemRows.length === 0) return;
                const currentQty = parseFloat(itemRows[0].Qty) || 0;
                const oldQty = currentQty + p.quantity;
                await productHistoryLogHelper({
                  productId: p.sourceItemId,
                  variationId: p.sourceVariationId || null,
                  quantityChange: -p.quantity,
                  oldQty: oldQty,
                  newQty: currentQty,
                  type: "Inter-Branch Transfer Out",
                  description: `Transferred ${p.quantity} units of "${p.name || ''}" from Warehouse: "${sourceWh.name}" to "${targetWh.name}" (${targetBranchName})`,
                  branchId: sourceWh.branch_id,
                  companyId: companyId,
                  userId: userId,
                  referenceId: targetWarehouseId,
                });
              }
            );

            // Inter-branch: Target branch incremented
            conn.query(
              "SELECT Qty FROM item WHERE idItem = ?",
              [p.targetItemId],
              async (err, itemRows) => {
                if (err || !itemRows || itemRows.length === 0) return;
                const currentQty = parseFloat(itemRows[0].Qty) || 0;
                const oldQty = Math.max(0, currentQty - p.quantity);
                await productHistoryLogHelper({
                  productId: p.targetItemId,
                  variationId: p.targetVariationId || null,
                  quantityChange: p.quantity,
                  oldQty: oldQty,
                  newQty: currentQty,
                  type: "Inter-Branch Transfer In",
                  description: `Received ${p.quantity} units of "${p.name || ''}" from Warehouse: "${sourceWh.name}" (${sourceBranchName}) into Warehouse: "${targetWh.name}"`,
                  branchId: targetWh.branch_id,
                  companyId: companyId,
                  userId: userId,
                  referenceId: sourceWarehouseId,
                });
              }
            );
          }
        } catch (historyErr) {
          console.error("Failed to log product history for transfer:", historyErr);
        }
      });

      return res.status(200).json({
        ok: true,
        message: isCrossBranch
          ? `Stock transferred successfully between ${sourceBranchName} and ${targetBranchName}.`
          : "Stock transferred successfully.",
        isCrossBranch,
        sourceBranchName,
        targetBranchName,
        sourceWarehouseName: sourceWh.name,
        targetWarehouseName: targetWh.name,
        transferredItems: processedItems,
        sourceWarehouse: {
          id: sourceWh.id,
          name: sourceWh.name,
          type: sourceWh.warehouse_type || "store",
          vehicleNumber: sourceWh.vehicle_number || null,
          responsiblePersonName: custodianOf(sourceWh).name,
          responsiblePersonPhone: custodianOf(sourceWh).phone,
        },
        targetWarehouse: {
          id: targetWh.id,
          name: targetWh.name,
          type: targetWh.warehouse_type || "store",
          vehicleNumber: targetWh.vehicle_number || null,
          responsiblePersonName: custodianOf(targetWh).name,
          responsiblePersonPhone: custodianOf(targetWh).phone,
        },
      });
    } catch (error) {
      console.error("transferStock transaction error:", error);
      return rollbackWith(500, {
        ok: false,
        message: error.message || "An error occurred during stock transfer.",
      });
    }
  });
};

exports.getUnassignedStock = (req, res) => {
  const branchId = Number(req.query.branchId);
  if (!branchId) {
    return res.status(400).json({ ok: false, message: "branchId is required" });
  }

  // 1. Fetch all items (non-services) for the branch
  const sqlItems = `
    SELECT i.idItem, i.Description, i.Item_Code, i.barcode, i.Cost, i.Rate, i.Qty AS total_qty, COALESCE(qt.Description, '') AS uom
    FROM item i
    LEFT JOIN quantity_type qt ON i.Qty_Type = qt.idQuantity_Type
    WHERE i.Branch_idBranch = ? AND (i.Type = '1' OR i.Type = 'Item') AND i.Status = 1
    ORDER BY i.Description ASC
  `;

  conn.query(sqlItems, [branchId], (err, items) => {
    if (err) {
      console.error("getUnassignedStock > items error:", err);
      return res.status(500).json({ ok: false, message: "Server error" });
    }

    if (!items || items.length === 0) {
      return res.json({ ok: true, items: [] });
    }

    const itemIds = items.map(i => i.idItem);
    const placeholders = itemIds.map(() => "?").join(",");

    // 2. Fetch assigned batches sum (EXCLUDING batches where warehouse_id is null or 0, and EXCLUDING unprocessed GRNs)
    const sqlBatches = `
      SELECT ib.item_id, ib.variation_id, COALESCE(SUM(ib.qty), 0) AS assigned_qty
      FROM item_batch ib
      LEFT JOIN grn g ON ib.grn_id = g.idGRN
      WHERE ib.item_id IN (${placeholders}) 
        AND ib.warehouse_id IS NOT NULL 
        AND ib.warehouse_id > 0
        AND (ib.grn_id IS NULL OR ib.grn_id = 0 OR g.Status = 1 OR g.Status = '1')
      GROUP BY ib.item_id, ib.variation_id
    `;

    conn.query(sqlBatches, itemIds, (err, batches) => {
      if (err) {
        console.error("getUnassignedStock > batches error:", err);
        return res.status(500).json({ ok: false, message: "Server error" });
      }

      // Create a map of item_id -> { total_assigned, variations: { variation_id -> assigned_qty } }
      const assignedMap = {};
      batches.forEach(b => {
        const itemId = b.item_id;
        const varId = b.variation_id || 'none';
        
        if (!assignedMap[itemId]) {
          assignedMap[itemId] = { total: 0, variations: {} };
        }
        
        assignedMap[itemId].total += Number(b.assigned_qty);
        assignedMap[itemId].variations[varId] = Number(b.assigned_qty);
      });

      // 3. Fetch variations if any
      const sqlVariations = `
        SELECT id, item_id, item_code, description, qty, cost, rate, barcode
        FROM item_variations
        WHERE item_id IN (${placeholders})
      `;

      conn.query(sqlVariations, itemIds, (err, variations) => {
        if (err) {
          console.error("getUnassignedStock > variations error:", err);
          return res.status(500).json({ ok: false, message: "Server error" });
        }

        const variationsMap = {};
        (variations || []).forEach(v => {
          if (!variationsMap[v.item_id]) {
            variationsMap[v.item_id] = [];
          }
          variationsMap[v.item_id].push(v);
        });

        // 3b. Fetch product barcodes if any
        const sqlProductBarcodes = `
          SELECT item_id, barcode
          FROM product_barcodes
          WHERE item_id IN (${placeholders})
        `;

        conn.query(sqlProductBarcodes, itemIds, (pbErr, pbRows) => {
          if (pbErr) {
            console.error("getUnassignedStock > product_barcodes error:", pbErr);
          }

          const productBarcodesMap = {};
          (pbRows || []).forEach(pb => {
            if (pb.barcode) {
              if (!productBarcodesMap[pb.item_id]) {
                productBarcodesMap[pb.item_id] = [];
              }
              productBarcodesMap[pb.item_id].push(pb.barcode);
            }
          });

          // 4. Construct response
          const resultItems = [];

          items.forEach(item => {
            const itemVariations = variationsMap[item.idItem] || [];
            const assigned = assignedMap[item.idItem] || { total: 0, variations: {} };
            const extraBarcodes = productBarcodesMap[item.idItem] || [];
            const itemBarcodes = [item.barcode, ...extraBarcodes].filter(Boolean);

            if (itemVariations.length > 0) {
              // Variation item
              const processedVars = [];
              let itemHasUnassigned = false;

              itemVariations.forEach(v => {
                const varAssigned = assigned.variations[v.id] || 0;
                const varUnassigned = Math.max(0, Number(v.qty) - varAssigned);

                if (varUnassigned > 0) {
                  itemHasUnassigned = true;
                }

                processedVars.push({
                  id: v.id,
                  variantSuffix: v.item_code, // Mapped variantSuffix to item_code for frontend
                  description: v.description,
                  barcode: v.barcode || item.barcode || "",
                  barcodes: [v.barcode, ...itemBarcodes].filter(Boolean),
                  qty: Number(v.qty),
                  cost: Number(v.cost || item.Cost),
                  rate: Number(v.rate || item.Rate),
                  assignedQty: varAssigned,
                  unassignedQty: varUnassigned
                });
              });

              if (itemHasUnassigned) {
                resultItems.push({
                  ...item,
                  barcode: item.barcode || "",
                  barcodes: itemBarcodes,
                  isVariation: true,
                  variations: processedVars,
                  unassignedQty: processedVars.reduce((sum, v) => sum + v.unassignedQty, 0)
                });
              }
            } else {
              // Normal item
              const itemAssigned = assigned.variations['none'] || assigned.total || 0;
              const itemUnassigned = Math.max(0, Number(item.total_qty) - itemAssigned);

              if (itemUnassigned > 0) {
                resultItems.push({
                  ...item,
                  barcode: item.barcode || "",
                  barcodes: itemBarcodes,
                  isVariation: false,
                  variations: [],
                  assignedQty: itemAssigned,
                  unassignedQty: itemUnassigned
                });
              }
            }
          });

          return res.json({ ok: true, items: resultItems });
        });
      });
    });
  });
};

exports.assignStock = async (req, res) => {
  const warehouseId = Number(req.params.id);
  const { userId, items } = req.body || {};

  if (!warehouseId) {
    return res.status(400).json({ ok: false, message: "warehouseId is required" });
  }
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false, message: "Items list is required" });
  }

  // Proactive Staging for ASSIGN_STOCK_SALESPERSON
  if (!req.is_approved_webhook) {
    try {
      // Assuming warehouse belongs to the same branch as the user making the request or the branch is implicit
      const companyId = req.headers["company_id"] || 1; // It's better to use user's company_id
      const approvalNeeded = await approvalService.isApprovalRequired(
        companyId,
        null, // branch_id may not be easily accessible here
        'ASSIGN_STOCK_SALESPERSON'
      );
      if (approvalNeeded) {
        await approvalService.triggerApprovalRequest({
          action_type: 'ASSIGN_STOCK_SALESPERSON',
          module_name: 'Warehouse',
          erp_record_id: warehouseId,
          company_id: companyId,
          branch_id: null,
          initiated_by: userId || (req.user ? req.user.id : null),
          payload_summary: JSON.stringify({
            warehouseId,
            itemsCount: items.length,
            pending_updates: {
               req_body: req.body,
               req_params: req.params,
               req_user: req.user
            }
          })
        });
        return res.status(202).json({
          message: "Assign Stock submitted for approval. It will take effect once approved.",
          approval_required: true,
          requires_approval: true,
          approval_name: "Assign Stock to Salesperson"
        });
      }
    } catch (err) {
      console.error("Approval Check Error:", err);
      return res.status(500).json({ error: "Failed to process approval workflow. Please try again." });
    }
  }

  conn.getConnection((err, connection) => {
    if (err) {
      console.error("assignStock getConnection error:", err);
      return res.status(500).json({ ok: false, message: "Server error" });
    }

    connection.beginTransaction((err) => {
      if (err) {
        connection.release();
        console.error("assignStock beginTransaction error:", err);
        return res.status(500).json({ ok: false, message: "Server error" });
      }

      const rollbackWith = (status, body) => {
        connection.rollback(() => {
          connection.release();
          res.status(status).json(body);
        });
      };

      // 1. Fetch warehouse to ensure it exists and get branch_id
      const sqlWh = `
        SELECT w.id, w.branch_id, w.name, b.Company_idCompany 
        FROM warehouses w 
        LEFT JOIN branch b ON w.branch_id = b.idBranch 
        WHERE w.id = ?
      `;
      connection.query(sqlWh, [warehouseId], (err, whRows) => {
        if (err || whRows.length === 0) {
          return rollbackWith(404, { ok: false, message: "Warehouse not found" });
        }
        const warehouse = whRows[0];
        const branchId = warehouse.branch_id;

        // Resolve user's own branch + company for history logging
        let userBranchId = branchId;
        let userCompanyId = warehouse.Company_idCompany;

        const sqlUser = `
          SELECT u.Branch_idBranch, b.Company_idCompany
          FROM user u
          LEFT JOIN branch b ON u.Branch_idBranch = b.idBranch
          WHERE u.idUser = ?
        `;
        connection.query(sqlUser, [userId], (err, userRows) => {
          if (!err && userRows && userRows.length > 0) {
            userBranchId = userRows[0].Branch_idBranch || userBranchId;
            userCompanyId = userRows[0].Company_idCompany || userCompanyId;
          }

          // 2. Process each item serially to check constraints and insert batches
          const processedItems = [];

          const processNext = (idx) => {
            if (idx >= items.length) {
              return finalizeAssignment(processedItems, warehouse, userBranchId, userCompanyId);
            }

          const reqItem = items[idx];
          const itemId = Number(reqItem.itemId);
          const varId = reqItem.variationId ? Number(reqItem.variationId) : null;
          const qtyToAssign = Number(reqItem.quantity);
          const zoneId = reqItem.warehouseZoneId || null;
          const rackId = reqItem.warehouseRackId || null;
          const cellId = reqItem.warehouseCellId || null;

          if (!itemId || !qtyToAssign || qtyToAssign <= 0) {
            return rollbackWith(400, { ok: false, message: `Invalid item or quantity at index ${idx}` });
          }

          // Fetch item details & check total quantity
          const sqlItem = `SELECT idItem, Description, Cost, Rate, Qty FROM item WHERE idItem = ? AND Branch_idBranch = ? FOR UPDATE`;
          connection.query(sqlItem, [itemId, branchId], (err, itemRows) => {
            if (err || itemRows.length === 0) {
              return rollbackWith(404, { ok: false, message: `Item ${itemId} not found in this branch` });
            }
            const item = itemRows[0];

            // If variation, fetch variation qty
            if (varId) {
              const sqlVar = `SELECT id, qty, cost, rate FROM item_variations WHERE id = ? AND item_id = ? FOR UPDATE`;
              connection.query(sqlVar, [varId, itemId], (err, varRows) => {
                if (err || varRows.length === 0) {
                  return rollbackWith(404, { ok: false, message: `Variation ${varId} for item ${itemId} not found` });
                }
                const variation = varRows[0];
                checkAndInsertBatch(item, variation, qtyToAssign, zoneId, rackId, cellId);
              });
            } else {
              checkAndInsertBatch(item, null, qtyToAssign, zoneId, rackId, cellId);
            }
          });

          // Helper to check unassigned stock and perform assignment using FIFO on unassigned batches or fallback new batches
          const checkAndInsertBatch = (itemObj, varObj, qty, zone, rack, cell) => {
            const targetVarId = varObj ? varObj.id : null;
            const targetQty = varObj ? Number(varObj.qty) : Number(itemObj.Qty);
            const targetCost = varObj ? Number(varObj.cost || itemObj.Cost) : Number(itemObj.Cost);
            const targetRate = varObj ? Number(varObj.rate || itemObj.Rate) : Number(itemObj.Rate);

            // 1. Fetch sum of assigned qty in item_batch (EXCLUDING unassigned batches and unprocessed GRN batches)
            const sqlSum = `
              SELECT COALESCE(SUM(ib.qty), 0) AS assigned_qty
              FROM item_batch ib
              LEFT JOIN grn g ON ib.grn_id = g.idGRN
              WHERE ib.item_id = ? 
                AND ib.variation_id <=> ? 
                AND ib.warehouse_id IS NOT NULL 
                AND ib.warehouse_id > 0
                AND (ib.grn_id IS NULL OR ib.grn_id = 0 OR g.Status = 1 OR g.Status = '1')
            `;
            connection.query(sqlSum, [itemObj.idItem, targetVarId], (err, sumRows) => {
              if (err) {
                return rollbackWith(500, { ok: false, message: "Database error during validation" });
              }
              const assigned = Number(sumRows[0].assigned_qty);
              const unassigned = Math.max(0, targetQty - assigned);

              if (qty > unassigned) {
                return rollbackWith(400, {
                  ok: false,
                  message: `Cannot assign ${qty} units of "${itemObj.Description}". Only ${unassigned} units are unassigned.`
                });
              }

              // 2. Query existing unassigned batches (warehouse_id IS NULL or 0) for FIFO reallocation (processed GRNs only)
              const sqlUnassigned = `
                SELECT ib.* 
                FROM item_batch ib
                LEFT JOIN grn g ON ib.grn_id = g.idGRN
                WHERE ib.item_id = ? 
                  AND ib.variation_id <=> ? 
                  AND (ib.warehouse_id IS NULL OR ib.warehouse_id = 0) 
                  AND ib.qty > 0
                  AND (ib.grn_id IS NULL OR ib.grn_id = 0 OR g.Status = 1 OR g.Status = '1')
                ORDER BY ib.batch_id ASC
                FOR UPDATE
              `;
              connection.query(sqlUnassigned, [itemObj.idItem, targetVarId], (err, unassignedBatches) => {
                if (err) {
                  console.error("Error fetching unassigned batches:", err);
                  return rollbackWith(500, { ok: false, message: "Error fetching unassigned batches" });
                }

                let remaining = qty;
                const batchesToProcess = [];

                if (unassignedBatches && unassignedBatches.length > 0) {
                  for (const b of unassignedBatches) {
                    if (remaining <= 0) break;
                    const take = Math.min(remaining, Number(b.qty));
                    batchesToProcess.push({ batch: b, qtyToMove: take });
                    remaining -= take;
                  }
                }

                // Function to process batches serially
                const processBatchReallocation = (bIdx) => {
                  if (bIdx >= batchesToProcess.length) {
                    // All unassigned batches processed. Any leftover qty represents opening stock (no batch exists)
                    if (remaining > 0) {
                      return insertNewOpeningBatch(remaining);
                    } else {
                      return finishItemAssignment();
                    }
                  }

                  const { batch, qtyToMove } = batchesToProcess[bIdx];

                  // A. Deduct qty from the unassigned batch
                  const sqlDeduct = "UPDATE item_batch SET qty = qty - ? WHERE batch_id = ?";
                  connection.query(sqlDeduct, [qtyToMove, batch.batch_id], (err) => {
                    if (err) {
                      console.error("Failed to deduct from unassigned batch:", err);
                      return rollbackWith(500, { ok: false, message: "Failed to deduct unassigned stock" });
                    }

                    // B. Find or create target batch in target warehouse
                    const sqlFind = `
                      SELECT batch_id FROM item_batch
                      WHERE item_id = ? AND warehouse_id = ?
                        AND warehouse_zone <=> ? AND warehouse_rack_id <=> ? AND warehouse_rack_cell <=> ?
                        AND batch_code <=> ? AND grn_id <=> ? AND variation_id <=> ?
                        AND cost = ? AND expiry_date <=> ?
                      LIMIT 1
                    `;
                    const paramsFind = [
                      batch.item_id,
                      warehouseId,
                      zone,
                      rack,
                      cell,
                      batch.batch_code,
                      batch.grn_id,
                      batch.variation_id,
                      batch.cost,
                      batch.expiry_date
                    ];

                    connection.query(sqlFind, paramsFind, (err, tRows) => {
                      if (err) {
                        console.error("Error finding target batch:", err);
                        return rollbackWith(500, { ok: false, message: "Target lookup error" });
                      }

                      if (tRows.length > 0) {
                        // Merge into existing target batch
                        const tBatchId = tRows[0].batch_id;
                        const sqlMerge = "UPDATE item_batch SET qty = qty + ? WHERE batch_id = ?";
                        connection.query(sqlMerge, [qtyToMove, tBatchId], (err) => {
                          if (err) return rollbackWith(500, { ok: false, message: "Target merge failed" });
                          processBatchReallocation(bIdx + 1);
                        });
                      } else {
                        // Insert new batch using values from source batch
                        const sqlInsert = `
                          INSERT INTO item_batch
                          (grn_id, item_id, warehouse_id, warehouse_zone, warehouse_rack_id, warehouse_rack_cell, qty, cost, rate, total_cost, updated_user_id, batch_code, variation_id, expiry_date)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `;
                        const totalCost = Number(batch.cost) * qtyToMove;
                        const paramsInsert = [
                          batch.grn_id,
                          batch.item_id,
                          warehouseId,
                          zone,
                          rack,
                          cell,
                          qtyToMove,
                          batch.cost,
                          batch.rate,
                          totalCost,
                          userId || null,
                          batch.batch_code,
                          batch.variation_id,
                          batch.expiry_date
                        ];
                        connection.query(sqlInsert, paramsInsert, (err) => {
                          if (err) return rollbackWith(500, { ok: false, message: "Target insert failed" });
                          processBatchReallocation(bIdx + 1);
                        });
                      }
                    });
                  });
                };

                // Helper to insert brand new batch for unbatched opening stock portion
                const insertNewOpeningBatch = (leftoverQty) => {
                  // We need a valid GRN ID because `grn_id` is a NOT NULL constraint on `item_batch`.
                  // 1. Check if there's any existing GRN for this branch.
                  const sqlGetGrn = `SELECT idGRN FROM grn WHERE Branch_idBranch = ? LIMIT 1`;
                  connection.query(sqlGetGrn, [branchId], (err, grnRows) => {
                    if (!err && grnRows && grnRows.length > 0) {
                      // Found an existing GRN! Use it.
                      const resolvedGrnId = grnRows[0].idGRN;
                      return performInsert(resolvedGrnId);
                    }

                    // 2. If no GRN found for this branch, locate a supplier, then create a dummy GRN.
                    const sqlGetSupplier = `SELECT idSupplier FROM supplier WHERE Branch_idBranch = ? LIMIT 1`;
                    connection.query(sqlGetSupplier, [branchId], (err, supplierRows) => {
                      if (!err && supplierRows && supplierRows.length > 0) {
                        const supplierId = supplierRows[0].idSupplier;
                        return createDummyGrn(supplierId);
                      }

                      // Try finding any supplier in the database
                      const sqlGetAnySupplier = `SELECT idSupplier FROM supplier LIMIT 1`;
                      connection.query(sqlGetAnySupplier, [], (err, anySupplierRows) => {
                        if (!err && anySupplierRows && anySupplierRows.length > 0) {
                          const supplierId = anySupplierRows[0].idSupplier;
                          return createDummyGrn(supplierId);
                        }

                        // No suppliers exist at all! Create a default supplier.
                        const sqlInsertSupplier = `
                          INSERT INTO supplier 
                          (Company_Name, Agent_Name, Contact_No, Contact_No2, Email, Address1, Address2, Address3, Status, Branch_idBranch, isDeleted) 
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `;
                        const supplierParams = [
                          'Opening Stock Supplier',
                          'System',
                          '0000000000',
                          '',
                          'supplier@example.com',
                          'System Address',
                          '',
                          '',
                          1,
                          branchId,
                          0
                        ];
                        connection.query(sqlInsertSupplier, supplierParams, (err, supplierRes) => {
                          if (err) {
                            console.error("Failed to create default supplier:", err);
                            return rollbackWith(500, { ok: false, message: "Failed to create default supplier for opening stock" });
                          }
                          const supplierId = supplierRes.insertId;
                          return createDummyGrn(supplierId);
                        });
                      });
                    });
                  });

                  const createDummyGrn = (supplierId) => {
                    const sqlInsertGrn = `
                      INSERT INTO grn 
                      (Date, Supplier_idSupplier, Bill_no, Items_Count, Total_Amount, Bill_Discount, Bill_Discount_Type, Discount_Amount, Net_Total, Paid_Amount, Credit_Balance_Amount, Status, Grn_File, Branch_idBranch) 
                      VALUES (NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `;
                    const grnParams = [
                      supplierId,
                      'OPENING-STOCK',
                      0,
                      0,
                      0,
                      'Amount',
                      0,
                      0,
                      0,
                      0,
                      0,
                      null,
                      branchId
                    ];
                    connection.query(sqlInsertGrn, grnParams, (err, grnRes) => {
                      if (err) {
                        console.error("Failed to create dummy GRN:", err);
                        return rollbackWith(500, { ok: false, message: "Failed to create dummy GRN for opening stock" });
                      }
                      const grnId = grnRes.insertId;
                      return performInsert(grnId);
                    });
                  };

                  const performInsert = (resolvedGrnId) => {
                    const randCode = Math.floor(10000 + Math.random() * 90000);
                    const batchCode = `BATCH-OP-${itemObj.idItem}-${randCode}`;

                    const sqlInsert = `
                      INSERT INTO item_batch
                      (grn_id, item_id, warehouse_id, warehouse_zone, warehouse_rack_id, warehouse_rack_cell, qty, cost, rate, total_cost, updated_user_id, batch_code, variation_id, expiry_date)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `;
                    const totalCost = targetCost * leftoverQty;
                    const paramsInsert = [
                      resolvedGrnId,
                      itemObj.idItem,
                      warehouseId,
                      zone,
                      rack,
                      cell,
                      leftoverQty,
                      targetCost,
                      targetRate,
                      totalCost,
                      userId || null,
                      batchCode,
                      targetVarId,
                      null // expiry_date
                    ];

                    connection.query(sqlInsert, paramsInsert, (err) => {
                      if (err) {
                        console.error("Insert opening batch error:", err);
                        return rollbackWith(500, { ok: false, message: "Failed to allocate opening stock batch" });
                      }
                      finishItemAssignment();
                    });
                  };
                };

                // Finalize this item and proceed
                const finishItemAssignment = () => {
                  // Log to stock_card
                  const sqlStockCard = `
                    INSERT INTO stock_card 
                    (Date, Item_idItem, Description, Transaction_Type, Transaction_ID, Cost, Real_Cost, Sell_Price, IN_Stock, Out_Stock, Branch_idBranch, Variation_Id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  `;
                  const paramsSC = [
                    new Date(),
                    itemObj.idItem,
                    `Stock Assignment to Warehouse: ${warehouse.name}`,
                    "STOCK_ADD",
                    warehouseId,
                    targetCost,
                    targetCost,
                    targetRate,
                    qty,
                    0,
                    branchId,
                    targetVarId || null,
                  ];
                  connection.query(sqlStockCard, paramsSC, (e) => {
                    if (e) console.error("Stock Card Assignment Log Error", e);
                  });

                  processedItems.push({
                    itemId: itemObj.idItem,
                    variationId: targetVarId,
                    name: itemObj.Description,
                    qty: qty
                  });

                  processNext(idx + 1);
                };

                // Start serial reallocation processing
                processBatchReallocation(0);
              });
            });
          };
        };

        const finalizeAssignment = (processed, wh, userBranchId, userCompanyId) => {
          // Write audit log
          const details = {
            type: "STOCK_ADD",
            reference: `Stock Assignment`,
            items: processed.map(p => ({
              id: p.itemId,
              name: p.name,
              qty: p.qty,
              variationId: p.variationId
            }))
          };
          const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || null;
          const ua = req.headers["user-agent"] || null;

          const sqlLog = `
            INSERT INTO warehouse_audit_logs
              (warehouse_id, branch_id, actor_user_id, action, details, ip_address, user_agent)
            VALUES (?, ?, ?, 'UPDATE', ?, ?, ?)
          `;
          connection.query(sqlLog, [warehouseId, branchId, userId, JSON.stringify(details), ip, ua], (err) => {
            if (err) console.error("Audit log failed for assignment:", err);

            connection.commit((err) => {
               if (err) {
                 return rollbackWith(500, { ok: false, message: "Commit failed" });
               }
               connection.release();
 
               // Log to user activities
               userLogDbService
                 .insertLog(
                   userId,
                   new Date(),
                   "assigned",
                   warehouseId,
                   "Stock Assignment",
                   branchId
                 )
                 .catch((err) => console.error("Recent Activity Log Error:", err));
 
               // Record product history logs for each assigned item
               processed.forEach(async (p) => {
                 try {
                   const companyId = await getCompanyIdByBranch(wh.branch_id);
                   conn.query(
                     "SELECT Qty FROM item WHERE idItem = ?",
                     [p.itemId],
                     async (err, itemRows) => {
                       if (!err && itemRows && itemRows.length > 0) {
                         await productHistoryLogHelper({
                           productId: p.itemId,
                           variationId: p.variationId || null,
                           quantityChange: 0,
                           oldQty: parseFloat(itemRows[0].Qty) || 0,
                           newQty: parseFloat(itemRows[0].Qty) || 0,
                           type: "Warehouse Assign",
                           description: `Assigned ${p.qty} units of "${p.name || ''}" to Warehouse: "${wh.name}"`,
                           branchId: wh.branch_id,
                           companyId: companyId,
                           userId: userId,
                           referenceId: warehouseId,
                         });
                       }
                     }
                   );
                 } catch (historyErr) {
                   console.error("Failed to log product history for assignment:", historyErr);
                 }
               });
 
               return res.status(200).json({
                 ok: true,
                 message: "Stock assigned successfully.",
                 assignedItems: processed
               });
             });
          });
        };

          processNext(0);
        });
      });
    });
  });
};

exports.applyPendingAssignStock = async (erp_record_id, pending_updates) => {
  const req = {
    body: pending_updates.req_body,
    params: pending_updates.req_params,
    user: pending_updates.req_user,
    is_approved_webhook: true 
  };
  
  const res = {
    status: function() { return this; },
    json: function(data) { console.log("[WEBHOOK] applyPendingAssignStock result:", data); return data; },
    send: function(data) { console.log("[WEBHOOK] applyPendingAssignStock result:", data); return data; }
  };

  return await exports.assignStock(req, res);
};


/**
 * POST /api/warehouses/:id/adjust-stock
 * Manually increase or decrease stock qty in a warehouse in sync with inventory levels.
 */
exports.adjustWarehouseStock = (req, res) => {
  const warehouseId = Number(req.params.id);
  const { userId, items, notes } = req.body || {};

  if (!warehouseId) {
    return res.status(400).json({ ok: false, message: "Warehouse ID is required" });
  }
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok: false, message: "At least one item is required for stock adjustment" });
  }

  conn.getConnection((err, connection) => {
    if (err) {
      console.error("adjustWarehouseStock getConnection error:", err);
      return res.status(500).json({ ok: false, message: "Database connection failed" });
    }

    connection.beginTransaction(async (beginErr) => {
      if (beginErr) {
        connection.release();
        return res.status(500).json({ ok: false, message: "Failed to start transaction" });
      }

      const rollbackWith = (status, body) => {
        connection.rollback(() => {
          connection.release();
          res.status(status).json(body);
        });
      };

      try {
        // 1. Fetch warehouse
        const [whRows] = await connection.promise().query(
          `SELECT w.id, w.branch_id, w.name FROM warehouses w WHERE w.id = ?`,
          [warehouseId]
        );
        if (!whRows || whRows.length === 0) {
          return rollbackWith(404, { ok: false, message: "Warehouse not found" });
        }
        const warehouse = whRows[0];
        const branchId = warehouse.branch_id;

        let companyId = await getCompanyIdByBranch(branchId);
        if (!companyId) {
          const [bRows] = await connection.promise().query(
            "SELECT Company_idCompany FROM branch WHERE idBranch = ? LIMIT 1",
            [branchId]
          );
          companyId = bRows[0]?.Company_idCompany;
        }
        if (!companyId) {
          const [phlRows] = await connection.promise().query(
            "SELECT Company_idCompany FROM product_history_log WHERE Branch_idBranch = ? AND Company_idCompany IS NOT NULL LIMIT 1",
            [branchId]
          );
          companyId = phlRows[0]?.Company_idCompany;
        }
        if (!companyId) {
          const [anyRows] = await connection.promise().query(
            "SELECT Company_idCompany FROM product_history_log WHERE Company_idCompany IS NOT NULL ORDER BY idProduct_History_Log DESC LIMIT 1"
          );
          companyId = anyRows[0]?.Company_idCompany || 1;
        }

        const safeUserId = userId || req.user?.id || req.user?.idUser || req.user?.userId || 1;

        // 2. Generate unique Adjustment Number for stock_adjustment table
        const [countRows] = await connection.promise().query(
          "SELECT COUNT(*) AS count FROM stock_adjustment WHERE Branch_idBranch = ?",
          [branchId]
        );
        const adjCount = (countRows[0]?.count || 0) + 1;
        const today = new Date();
        const yyyymmdd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
        const adjustmentNumber = `STK-ADJ-WH-${yyyymmdd}-${String(adjCount).padStart(4, "0")}`;

        // 3. Create entry in stock_adjustment table
        const pad = (n) => String(n).padStart(2, "0");
        const formattedDate = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())} ${pad(today.getHours())}:${pad(today.getMinutes())}:${pad(today.getSeconds())}`;
        const adjNotes = notes || `Warehouse stock adjustment in ${warehouse.name}`;

        const [adjRes] = await connection.promise().query(
          `INSERT INTO stock_adjustment (Adjustment_Number, Date, Notes, User_idUser, Branch_idBranch) VALUES (?, ?, ?, ?, ?)`,
          [adjustmentNumber, formattedDate, adjNotes, safeUserId, branchId]
        );
        const adjustmentId = adjRes.insertId;

        const processedResults = [];

        // 4. Process each item
        for (let idx = 0; idx < items.length; idx++) {
          const reqItem = items[idx];
          const itemId = Number(reqItem.itemId);
          const varId = reqItem.variationId ? Number(reqItem.variationId) : null;
          const batchId = reqItem.batchId ? Number(reqItem.batchId) : null;
          const adjType = reqItem.adjustmentType || "add"; // "add", "deduct", "set"
          const rawQty = Math.abs(Number(reqItem.adjustmentQty || 0));
          const reason = reqItem.reason || "Manual Stock Adjustment";
          const zoneId = reqItem.warehouseZoneId ? Number(reqItem.warehouseZoneId) : null;
          const rackId = reqItem.warehouseRackId ? Number(reqItem.warehouseRackId) : null;
          const cellId = reqItem.warehouseCellId ? Number(reqItem.warehouseCellId) : null;

          if (!itemId || isNaN(rawQty)) {
            return rollbackWith(400, { ok: false, message: `Invalid item or quantity at index ${idx}` });
          }

          // Fetch item
          const [itemRows] = await connection.promise().query(
            "SELECT idItem, Description, Cost, Real_Cost, Rate, Qty, Branch_idBranch FROM item WHERE idItem = ? FOR UPDATE",
            [itemId]
          );
          if (!itemRows || itemRows.length === 0) {
            return rollbackWith(404, { ok: false, message: `Product ${itemId} not found` });
          }
          const itemObj = itemRows[0];
          const oldProductQty = parseFloat(itemObj.Qty) || 0;

          // Fetch variation if any
          let varObj = null;
          let oldVarQty = 0;
          if (varId) {
            const [varRows] = await connection.promise().query(
              "SELECT id, item_id, description, item_code, cost, rate, qty FROM item_variations WHERE id = ? AND item_id = ? FOR UPDATE",
              [varId, itemId]
            );
            if (!varRows || varRows.length === 0) {
              return rollbackWith(404, { ok: false, message: `Variation ${varId} not found for product ${itemId}` });
            }
            varObj = varRows[0];
            oldVarQty = parseFloat(varObj.qty) || 0;
          }

          // Fetch warehouse batches for this item/variation
          let whBatches = [];
          if (batchId) {
            const [bRows] = await connection.promise().query(
              "SELECT * FROM item_batch WHERE batch_id = ? AND warehouse_id = ? FOR UPDATE",
              [batchId, warehouseId]
            );
            whBatches = bRows;
          } else {
            const [bRows] = await connection.promise().query(
              `SELECT * FROM item_batch 
               WHERE item_id = ? AND (variation_id <=> ?) AND warehouse_id = ? 
               ORDER BY batch_id ASC FOR UPDATE`,
              [itemId, varId, warehouseId]
            );
            whBatches = bRows;
          }

          const currentWhQty = whBatches.reduce((acc, b) => acc + (parseFloat(b.qty) || 0), 0);

          // Calculate delta
          let delta = 0;
          if (adjType === "add") {
            delta = rawQty;
          } else if (adjType === "deduct") {
            delta = -rawQty;
          } else if (adjType === "set") {
            delta = rawQty - currentWhQty;
          }

          if (delta === 0) {
            continue;
          }

          // Validation
          if (delta < 0) {
            const neededDeduct = Math.abs(delta);
            if (currentWhQty < neededDeduct) {
              return rollbackWith(400, {
                ok: false,
                message: `Cannot deduct ${neededDeduct} units of "${itemObj.Description}". Only ${currentWhQty} units are available in warehouse "${warehouse.name}".`
              });
            }
            if (oldProductQty + delta < 0) {
              return rollbackWith(400, {
                ok: false,
                message: `Cannot deduct ${neededDeduct} units. Total product inventory cannot be negative.`
              });
            }
            if (varId && oldVarQty + delta < 0) {
              return rollbackWith(400, {
                ok: false,
                message: `Cannot deduct ${neededDeduct} units. Total variation inventory cannot be negative.`
              });
            }

            // Deduct from batches
            let toDeduct = neededDeduct;
            for (const b of whBatches) {
              if (toDeduct <= 0) break;
              const bQty = parseFloat(b.qty) || 0;
              const take = Math.min(toDeduct, bQty);
              await connection.promise().query(
                "UPDATE item_batch SET qty = qty - ? WHERE batch_id = ?",
                [take, b.batch_id]
              );
              toDeduct -= take;
            }
          } else {
            // delta > 0 (Increase)
            if (batchId && whBatches.length > 0) {
              await connection.promise().query(
                "UPDATE item_batch SET qty = qty + ? WHERE batch_id = ?",
                [delta, batchId]
              );
            } else if (whBatches.length > 0) {
              const latestBatch = whBatches[whBatches.length - 1];
              await connection.promise().query(
                "UPDATE item_batch SET qty = qty + ? WHERE batch_id = ?",
                [delta, latestBatch.batch_id]
              );
            } else {
              const unitCost = varObj ? Number(varObj.cost || itemObj.Cost) : Number(itemObj.Cost || 0);
              const totalCost = unitCost * delta;
              await connection.promise().query(
                `INSERT INTO item_batch 
                 (item_id, variation_id, warehouse_id, warehouse_zone, warehouse_rack_id, warehouse_cell_id, qty, cost, total_cost, date, status, Branch_idBranch)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), 1, ?)`,
                [itemId, varId, warehouseId, zoneId, rackId, cellId, delta, unitCost, totalCost, branchId]
              );
            }
          }

          // Synchronize total product inventory
          const newProductQty = oldProductQty + delta;
          await connection.promise().query(
            "UPDATE item SET Qty = ? WHERE idItem = ?",
            [newProductQty, itemId]
          );

          // Synchronize variation inventory if applicable
          let newVarQty = oldVarQty;
          if (varId) {
            newVarQty = oldVarQty + delta;
            await connection.promise().query(
              "UPDATE item_variations SET qty = ? WHERE id = ?",
              [newVarQty, varId]
            );
          }

          // Insert into stock_adjustment_items
          await connection.promise().query(
            `INSERT INTO stock_adjustment_items 
             (Stock_Adjustment_idStock_Adjustment, Product_idItem, Old_Qty, Adjustment_Qty, New_Qty)
             VALUES (?, ?, ?, ?, ?)`,
            [adjustmentId, itemId, oldProductQty, delta, newProductQty]
          );

          // Log in product history log
          const descSuffix = varObj ? ` [Variation: ${varObj.description || varObj.item_code}]` : "";
          const actionText = delta > 0 ? `Increased by +${delta}` : `Decreased by ${delta}`;
          await productHistoryLogHelper({
            productId: itemId,
            variationId: varId,
            quantityChange: delta,
            oldQty: oldProductQty,
            newQty: newProductQty,
            type: "Stock Adjustment",
            description: `Warehouse Stock Adjustment in "${warehouse.name}"${descSuffix}: ${actionText} (${reason}). WH stock: ${currentWhQty} -> ${currentWhQty + delta}. Total stock: ${oldProductQty} -> ${newProductQty}`,
            branchId,
            companyId,
            userId: safeUserId,
            referenceId: adjustmentId,
            connection
          });

          // Log in stock card
          const in_qty = delta > 0 ? delta : 0;
          const out_qty = delta < 0 ? Math.abs(delta) : 0;
          await stockCardDbService.insertStockCard(
            itemId,
            itemObj.Description,
            "adjustQty",
            adjustmentId,
            itemObj.Cost,
            itemObj.Real_Cost,
            itemObj.Rate,
            in_qty,
            out_qty,
            newProductQty,
            branchId,
            connection,
            varId
          );

          // Accounting: Post standard double entry for stock adjustment
          if (delta !== 0) {
            const unitCostVal = varObj
              ? parseFloat(varObj.cost || varObj.real_cost || itemObj.Cost || itemObj.Real_Cost || 0)
              : parseFloat(itemObj.Cost || itemObj.Real_Cost || 0);

            await postStockAdjustmentAccounting({
              productId: itemId,
              productName: itemObj.Description,
              deltaQty: delta,
              unitCost: unitCostVal,
              branchId,
              companyId,
              userId: safeUserId,
              reference: `Warehouse Stock Adjustment (${adjustmentId})`,
              notes: `Warehouse "${warehouse.name}" adjustment (${reason})`,
              connection,
            });
          }

          processedResults.push({
            itemId,
            variationId: varId,
            name: itemObj.Description,
            oldWhQty: currentWhQty,
            newWhQty: currentWhQty + delta,
            delta,
            oldProductQty,
            newProductQty,
          });
        }

        // 5. Update warehouse stock_count and item_count counters
        await connection.promise().query(
          `UPDATE warehouses w
           SET 
             stock_count = COALESCE((SELECT SUM(ib.qty) FROM item_batch ib LEFT JOIN grn g ON ib.grn_id = g.idGRN WHERE ib.warehouse_id = w.id AND ib.qty > 0 AND (ib.grn_id IS NULL OR ib.grn_id = 0 OR g.Status = 1 OR g.Status = '1')), 0),
             item_count = COALESCE((SELECT COUNT(DISTINCT ib.item_id) FROM item_batch ib LEFT JOIN grn g ON ib.grn_id = g.idGRN WHERE ib.warehouse_id = w.id AND ib.qty > 0 AND (ib.grn_id IS NULL OR ib.grn_id = 0 OR g.Status = 1 OR g.Status = '1')), 0)
           WHERE w.id = ?`,
          [warehouseId]
        );

        // 6. Write to warehouse_audit_logs
        const auditDetails = {
          type: "STOCK_ADJUSTMENT",
          reference: adjustmentNumber,
          warehouseName: warehouse.name,
          notes: adjNotes,
          items: processedResults.map((p) => ({
            id: p.itemId,
            name: p.name,
            delta: p.delta,
            newWhQty: p.newWhQty,
            newProductQty: p.newProductQty
          }))
        };
        const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || null;
        const ua = req.headers["user-agent"] || null;

        await connection.promise().query(
          `INSERT INTO warehouse_audit_logs
             (warehouse_id, branch_id, actor_user_id, action, details, ip_address, user_agent)
           VALUES (?, ?, ?, 'UPDATE', ?, ?, ?)`,
          [warehouseId, branchId, safeUserId, JSON.stringify(auditDetails), ip, ua]
        );

        // 7. Write to user action log
        await userLogDbService.insertLog(
          safeUserId,
          new Date(),
          "adjusted",
          adjustmentId,
          "Warehouse Stock Adjustment",
          branchId,
          connection
        );

        // 8. Commit transaction
        connection.commit((commitErr) => {
          if (commitErr) {
            return rollbackWith(500, { ok: false, message: "Transaction commit failed" });
          }
          connection.release();
          return res.status(200).json({
            ok: true,
            message: "Warehouse stock adjusted successfully and synchronized with inventory levels.",
            adjustmentNumber,
            adjustmentId,
            items: processedResults
          });
        });

      } catch (errCatch) {
        console.error("adjustWarehouseStock error:", errCatch);
        return rollbackWith(500, { ok: false, message: errCatch.message || "Server error during stock adjustment" });
      }
    });
  });
};

