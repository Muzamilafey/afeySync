# Ward medication: order → pharmacy → dispense → receive → chart

Inpatient medication follows a closed loop so every dose on the MAR can be traced
back to a prescriber's order and a pharmacy dispense.

## 1. Order (inpatient page → "Medication orders" tab)

- Search the drug list (the facility's pharmacy items, with usable stock shown).
- Enter dose, frequency, route, days and quantity. Allergy checks and override reasons
  work the same way as for outpatient prescriptions.
- Choose the urgency: **Routine**, **Urgent** or **STAT**.
- Click **Send to pharmacy**. The server checks that the patient is still admitted and
  saves a snapshot of the ward and bed on the order. Users whose role has `pharmacy.dispense`
  get a notification, and STAT requests are marked as STAT.

## 2. Dispense (Pharmacy → "Ward requests" tab)

- Ward requests are listed apart from outpatient prescriptions. They show the ward and bed
  and are sorted **STAT → urgent → oldest first**. A banner warns when STAT requests are waiting.
- Dispensing uses the normal FEFO batch selection and never uses expired stock. Partial
  dispensing is allowed.
- The prescriber is notified when the order is dispensed.

## 3. Receive (inpatient page → "Medication orders")

- A nurse (`nursing.record`) clicks **Confirm received** when the drugs arrive on the ward.
  The receipt (who, when and how many dispenses it covers) is audited, and the prescriber is notified.
- The pharmacy list then shows "received on ward" (or "awaiting ward receipt").

## 4. Chart (inpatient page → "Medication (MAR)")

- Pick the drug from the patient's active medication orders. Dose and route are filled in from
  the order, and the MAR entry is linked to the prescription and order item.
- For ward-stock drugs that have no order, search the drug list instead. The entry is linked to that item.
- An order or item that has been cancelled cannot be charted (`ORDER_CANCELLED`). Orders from
  another admission are rejected.

All checks run on the server. The UI only hides buttons the user cannot use.
