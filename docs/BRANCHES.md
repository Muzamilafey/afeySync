# Branches

* Branches live inside the facility's tenant database and are identified by
  `tenantId + branchId`. They never get their own database.
* Admin → Organization → Branches: create, edit or configure (address, codes, level, beds, and
  services such as OPD, IP, maternity, lab, radiology, pharmacy, dental, mortuary and billing),
  suspend or activate (the main branch cannot be suspended), and assign staff
  (`PUT /branches/:id/staff`). Subscriptions cap the number of branches.
* Users have `All Branches` or `Specific Branches` access. The active branch is chosen in the top
  bar (`X-Branch-Id`) and the server validates it.
* Patients carry `registeredBranchId` and `branchIds`. A branch-scoped user only sees patients in
  their branches. Duplicate checks always run tenant-wide but return only minimal data for other
  branches. To bring a patient into the current branch, use **Link to my branch** and supply the
  patient number plus a matching identifier. The action is audited.
* Optional branch domains (`main.hospital.co.ke`) are `TenantDomain` entries of type `branch`.
