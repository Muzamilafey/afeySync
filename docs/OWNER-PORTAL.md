# Owner portal (`owner.afeysync.com`)

* **Dashboard**: tenants, active, online and issues; branches and users; integration health; API
  usage; subscriptions. It shows no patient data.
* **Facilities**: search and filter; 8-step wizard; details tabs (Overview, Branches, Users,
  Domains, Subscription, Integrations, Health, Audit); suspend and activate; reset the facility
  admin; create a branch; add and verify domains.
* **Integrations**: SHA, DHA HIE, M-Pesa, Africa's Talking, SMTP and storage. Actions: enable or
  disable globally, set the environment, rotate credentials, allow facility credentials, and run
  tests (auth / registry / eligibility / terminology / email).
* **API Config**: edit the HIE contract (operation paths from the official catalog) and record the
  contract version and verification date.
* **Integration logs**: filter by tenant, provider, operation, status, date and reference.
* **Jobs & Queues**: view jobs and retry dead-lettered ones.
* **System Health**: API, MongoDB, queue, integrations, CPU/RAM/storage.
* **Support Access**: request time-limited access that a facility must approve. Every use is
  audited.
* **Platform Audit** and **Platform Users**.
