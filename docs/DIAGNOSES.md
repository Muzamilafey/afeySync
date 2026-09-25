# Diagnosis catalog

Each facility keeps its own list of diagnoses and diseases in **Admin → Diagnoses**.

* It starts with about 50 common admission diagnoses for Kenyan facilities, e.g. severe malaria,
  pneumonia, pre-eclampsia, PPH and road traffic injuries.
* These are **names only**. ICD codes are not pre-filled, because a wrong code would flow into
  records and claims. Add the codes your facility uses (ICD-11, ICD-10 or a local code).
* Each entry has a name, an optional code and code system, a category, other names or abbreviations
  (e.g. "CVA" finds Stroke), "offer when admitting", "notifiable disease" and active.
* Bulk add and update with Excel (Import from Excel), with a preview before anything is saved.
* **Admission form:** the diagnosis field suggests entries as you type:
  * entries from this list (admission entries first)
  * diagnoses this facility recently used for admissions
  * national DHA terminology, when it is connected

  Staff can still type any diagnosis.
* **Consultation diagnosis search** also shows matches from this list first.

Managed by users with `admin.settings`. Changes are audited.
