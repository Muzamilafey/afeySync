# Price lists: cash, SHA, insurance, foreigner

Every billable service (Billing → Services & Prices), including each drug's billing service
(`RX-<item code>`), can have a price on each list:

| List | Who is billed at it |
|---|---|
| `cash` | Kenyan patients paying cash. Also the **fallback** for any list without its own price. |
| `sha` | Visits whose payer is SHA |
| `insurance` | Visits whose payer is insurance or corporate |
| `foreigner` | Cash-paying patients whose nationality on their record is not Kenyan |

Extra scheme-specific lists (for example `aar_gold`) can still be added on a service.

* The list is chosen **by the server** when the visit's invoice is opened, from the visit's payer and
  the patient's nationality. The browser never sends a price.
* SHA and insurance payers always use their own list, whatever their nationality.
* A service without a price on the chosen list is billed at its cash price. With no price at all, the
  line is marked `[PRICE NOT SET]` at KES 0 for the cashier to correct.

## Drug and stock item prices

Selling prices can be set on the inventory item itself (Inventory → Items → New item / Edit):
Cash, SHA, Insurance and Foreigner, per stock unit. They are stored on the item's billing service, so
Services & Prices shows the same prices. Only users with `billing.prices` see and change prices.
Every change is audited (`billing.price_update`, with old and new prices). Stock is never entered on
the item: it comes from receiving batches (Inventory → Receive).

The Items list shows each item's usable stock at the current branch (red when out, amber at or below
the reorder level), how much is expired, and its prices ("no price" when none is set yet).
