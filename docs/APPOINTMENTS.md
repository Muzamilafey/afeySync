# Appointments

**Front Desk → Appointments** lists bookings as a **List** (tabs **Today / Upcoming / Past / All**)
or a week **Calendar**. You can search by patient name, phone, patient number or APT number,
filter by status, practitioner and service, and **Export** the current view as CSV. The CSV is
audited, and cells are protected against spreadsheet formulas.

## Booking (New appointment)

1. **Select patient**: search by patient number, name, phone or national ID. Quick results appear as
   you type, and **Show all results** opens a table with a **Book** button on each row. You can also
   use **Book appointment** on a patient's page.
2. **Appointment details**: a patient summary (phone masked, with an eye button to show it) and a
   **Remove** button. Then:
   * **Book by Service** (from the catalogue: consultation, procedure, dental, imaging, lab, maternity,
     nursing; the practitioner is optional) or **by Practitioner** (the service is optional).
   * **Date** (with Today / Tomorrow / In 1 week / … shortcuts), **duration**, then a free **time
     slot**. Slots run through clinic hours (08:00–17:00, Kenya time). Slots in the past, or when the
     practitioner or the patient is already booked, cannot be picked.
   * **Reason** from a list, optional notes, and an SMS confirmation plus a reminder the day before.

The server checks everything again: no time in the past, no clash for the practitioner
(`APPOINTMENT_CLASH`), no overlapping bookings for the patient (`PATIENT_DOUBLE_BOOKED`), and only
active, bookable services.

## Book a course

For repeat sessions (for example physiotherapy): choose the first session's time, the number of
sessions (2–30) and how often (every day up to every 4 weeks). All sessions are checked first. If any
session clashes, **nothing is booked** and the clashing dates are listed (`COURSE_CLASH`). Sessions show
as "Session n of N". The patient gets one SMS for the course and a reminder before each session.
