# Excel bulk import

Two catalogs can be loaded or updated in bulk from Excel:

| What | Where | Who |
|---|---|---|
| Services & prices | Billing → Services & Prices → **Import from Excel** | `billing.prices` |
| Inventory items | Inventory → Items → **Import from Excel** | `pharmacy.stock` or `inventory.manage` |

## How it works

1. **Download the template.** It is an `.xlsx` workbook with the facility's name and brand colour:
   * a data sheet: required columns marked `*`, drop-downs for fixed values (category, Yes/No),
     number checks, a note on each header and the header rows frozen
   * an **Instructions** sheet explaining every column
   * an **Examples** sheet, which is never imported
2. **Fill it in**, one row per entry from row 4. The code identifies the record: an existing code
   updates it, a new code creates it.
3. **Upload and review.** The preview lists every row as *New*, *Update* (with the exact changes,
   e.g. `cash: 1200 → 1300`), *No change* or *Problem*, using the same row numbers as Excel.
4. **Import.** Nothing is saved while any row has a problem; the whole file is refused
   (`IMPORT_HAS_ERRORS`). Fix the rows shown and upload again.

## Services & prices

* One `Price: <list> (KES)` column for each price list in use (`cash`, `sha` and `insurance` are
  always included). To add a price list, add a column titled `Price: <name> (KES)`.
* A blank price leaves that price list unchanged. Prices on lists that are not in the file are kept.
* A new service needs at least one price.
* Every created or changed service is written to the audit trail as `billing.service_create` or
  `billing.price_change`, with `source: excel_import`, plus one summary entry for the file.

## Inventory items

* Sets up the item list only (code, names, form, strength, unit, category, reorder level,
  controlled flag, billing service code, active). Stock quantities, batches and expiry dates are
  received through Inventory → Receive, so they stay traceable to a delivery.

## Limits

`.xlsx` only (not `.xls` or CSV), up to 5 MB and 5,000 rows per file. Header matching ignores case,
`*` and column order, and extra columns are ignored.
