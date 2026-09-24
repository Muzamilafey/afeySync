# API

* Base path: `/api/v1`. The OpenAPI document is served at `/api/docs` (Swagger UI) and
  `/api/docs/openapi.json`.
* Authentication: `Authorization: Bearer <access token>`. The refresh token is a cookie.
  Branch selection uses `X-Branch-Id`.
* Success responses: `{ "success": true, "data": …, "meta": { page, limit, total } }`.
* Error responses: `{ "success": false, "error": { "code": "DHA_VALIDATION_ERROR", "message": "…", "requestId": "…" } }`.
* Idempotency: SHA transactions accept `idempotencyKey`. Jobs and callback events are deduplicated
  by unique keys.
* Main groups: `/auth`, `/owner/*`, `/branches`, `/users`, `/roles`, `/permissions`, `/admin/*`,
  `/patients`, `/dha/*`, `/sha/*`, `/dashboard`, `/notifications`, and the public
  `/sha|dha/callbacks/:token`.
* The schemas for external SHA/DHA calls are defined by the official DHA HIE documentation and are
  not redefined here.
