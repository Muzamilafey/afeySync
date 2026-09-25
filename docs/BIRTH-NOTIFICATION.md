# Baby registration and birth notification

After a delivery is recorded (Maternity → pregnancy → **Delivery & newborn**), each baby has a
**Register baby & birth notice** action.

## Registering the baby

- Staff enter the child's names in the same order as the Form B1: **First name**, **Other name**
  and **Father's name**. The mother's ID number, who the notification is issued to (mother, father,
  guardian or other, with their ID number) and, optionally, the serial number of the official
  government Form B1 are also entered.
- Live-born babies already have a patient record ("Baby of …") from the delivery. Registering
  gives that record the child's names.
- **Sex, date of birth, type of birth (single / twin / triplet), nature of birth (born alive / born
  dead), birth weight and place of birth come from the delivery record on the server.** The form
  cannot change them. Stillbirths are notified as "born dead" and have no newborn patient record.
- Each baby gets one notification numbered `BN-000001`, `BN-000002`, and so on. Trying to issue a second one
  for the same baby is refused (`BIRTH_NOTIFICATION_EXISTS`).

## Printing: two copies on one A4 portrait page

- The print page lays out the **Parent's copy** on top and the **Facility copy** below, with a cut line
  between them. Each copy has the facility letterhead with its logo and follows the Form B1 layout
  (fields 1 to 8, then "Notification issued to … ID No.").
- The parent's copy says it is not a birth certificate and tells the parent to take it to the Civil
  Registration office. The facility copy has a line for the parent's signature on receipt.
- Every print is recorded, whether from the button or Ctrl+P (`printCount`, audited). Once a notification
  has been printed, any later print is marked **DUPLICATE**.

## Corrections

Details can be corrected (for example a misspelt name). A reason is required, the previous values are
kept in the record's correction history and the audit log, and the baby's patient record is renamed too.

## What AfeySync does not do

AfeySync does not generate official Form B1 serial numbers and does not submit anything to the Civil
Registration Service. The birth is registered, and the certificate issued, by the Civil Registration Service.
The **Birth notifications** tab on the Maternity page is the facility's register of notices issued.
