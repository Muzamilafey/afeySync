# Owner portal (`owner.afeysync.com`)

* **Dashboard**: tenants, active, online and issues; branches and users; integration health; API
  usage; subscriptions. It shows no patient data.
* **Facilities**: search and filter; 8-step wizard; details tabs (Overview, Branches, Users,
  Domains, Subscription, Integrations, Health, Audit); suspend and activate; reset the facility
  admin; create a branch; add and verify domains.
* **Registrations**: review self-service facility registrations from `/get-started`, approve (which
  provisions the facility) or reject with a reason, and choose manual or automatic approval.
* **Plans & Modules**: prices, limits, trial days and the modules each plan switches on.
* **Billing**: quotations, invoices and service agreements with automatic signature and stamp,
  email with PDF, M-Pesa prompts, manual payments, allocation of paybill payments, and business
  settings (see BILLING.md).
* **Integrations**: SHA, DHA HIE, M-Pesa (including optional B2C payouts), Africa's Talking and Talksasa SMS, SMTP, Google Sign-In, Slade360 (facility credentials only) and storage. Actions: enable or
  disable globally, set the environment, rotate credentials, allow facility credentials, and run
  tests (auth / registry / eligibility / terminology / email).
* **API Config**: edit the SHA, DHA HIE and Slade360 contracts (operation paths from the official
  documentation) and record the contract version and verification date. Each operation shows
  whether it is documented, taken from the specification but unverified, or verified by the owner.
* **Integration logs**: filter by tenant, provider, operation, status, date and reference.
* **Jobs & Queues**: view jobs and retry dead-lettered ones.
* **System Health**: API, MongoDB, queue, integrations, CPU/RAM/storage.
* **Support Access**: request time-limited access that a facility must approve. Every use is
  audited.
* **Backups**: last successful backup per facility, stale or failed flags, and recent runs.
* **Security**: your own two-step verification and Google link, plus the platform-wide MFA policy.
* **Platform Audit** and **Platform Users** (MFA status and reset).
