import express, { type Request } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { env, isProd } from './config/env';
import { logger } from './utils/logger';
import { requestId } from './middleware/requestContext';
import { sanitizeInput } from './middleware/sanitize';
import { resolveTenantHost } from './middleware/tenantResolver';
import { requirePlanModule } from './modules/plans/planService';
import { planOwnerRouter } from './modules/plans/plans.routes';
import { billingOwnerRouter } from './modules/platformBilling/owner.routes';
import { subscriptionRouter } from './modules/platformBilling/facility.routes';
import { platformMpesaPublicRouter } from './modules/platformBilling/platformMpesa';
import { onboardingOwnerRouter, onboardingPublicRouter } from './modules/onboarding/onboarding.routes';
import { contactRouter } from './modules/contact/contact.routes';
import { blogOwnerRouter, blogPublicRouter } from './modules/blog/blog.routes';
import { announcementOwnerRouter, announcementTenantRouter } from './modules/announcements/announcements.routes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import healthRoutes from './modules/health/health.routes';
import tenantAuthRoutes from './modules/auth/tenantAuth.routes';
import selfServiceRoutes from './modules/auth/selfService.routes';
import diagnosisRoutes from './modules/diagnoses/diagnoses.routes';
import { smsOwnerRouter, smsWalletRouter } from './modules/sms/sms.routes';
import { googleCallbackRouter } from './modules/auth/google/google.routes';
import ownerAuthRoutes from './modules/auth/ownerAuth.routes';
import ownerRoutes from './modules/owner/owner.routes';
import branchRoutes from './modules/branches/branches.routes';
import { permissionsRouter, rolesRouter, usersRouter } from './modules/users/users.routes';
import adminRoutes from './modules/admin/admin.routes';
import patientRoutes from './modules/patients/patients.routes';
import dhaRoutes from './modules/dha/dha.routes';
import shaRoutes from './modules/sha/sha.routes';
import shaClaimsRoutes from './modules/sha/shaClaims.routes';
import shaVisitRoutes from './modules/sha/shaVisit.routes';
import callbackRoutes from './modules/callbacks/callbacks.routes';
import notificationRoutes from './modules/notifications/notifications.routes';
import dashboardRoutes from './modules/dashboard/dashboard.routes';
import billingRoutes from './modules/billing/billing.routes';
import { queuesRouter, referralsRouter, visitsRouter } from './modules/frontdesk/visits.routes';
import appointmentRoutes from './modules/frontdesk/appointments.routes';
import { consultationsRouter, opdRouter } from './modules/opd/opd.routes';
import labRoutes from './modules/laboratory/lab.routes';
import radiologyRoutes from './modules/radiology/radiology.routes';
import pharmacyRoutes from './modules/pharmacy/pharmacy.routes';
import insuranceRoutes from './modules/insurance/insurance.routes';
import ePrescriptionRoutes from './modules/eprescription/eprescription.routes';
import procurementRoutes from './modules/procurement/procurement.routes';
import inpatientRoutes from './modules/inpatient/inpatient.routes';
import { fpRouter, maternityRouter, mchRouter } from './modules/maternity/maternity.routes';
import dentalRoutes from './modules/dental/dental.routes';
import mortuaryRoutes from './modules/mortuary/mortuary.routes';
import documentRoutes from './modules/documents/documents.routes';
import financeRoutes from './modules/finance/finance.routes';
import hrRoutes from './modules/hr/hr.routes';
import reportRoutes from './modules/reports/reports.routes';
import fhirRoutes from './modules/fhir/fhir.routes';
import { mpesaPublicRouter, mpesaRouter } from './modules/billing/mpesa.routes';
import { openApiSpec } from './openapi';
import { h } from './utils/asyncHandler';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Trust only the configured proxy chain (nginx/Cloudflare) for req.ip / req.hostname.
  app.set('trust proxy', env.TRUST_PROXY === 'false' ? false : env.TRUST_PROXY);

  app.use(requestId);
  app.use(pinoHttp({ logger, genReqId: (req) => (req as Request).requestId, autoLogging: env.NODE_ENV !== 'test' }));
  app.use(helmet({ contentSecurityPolicy: isProd ? undefined : false, crossOriginResourcePolicy: { policy: 'same-site' } }));

  const allowed = new Set([env.FRONTEND_URL, env.OWNER_URL, ...env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)]);
  const platformRe = new RegExp(`^https?://([a-z0-9-]+\\.)?${env.PLATFORM_DOMAIN.replace(/\./g, '\\.')}(:\\d+)?$`);
  app.use(
    cors({
      credentials: true,
      origin: (origin, cb) => {
        // Same-origin/non-browser requests have no Origin header.
        if (!origin || allowed.has(origin) || platformRe.test(origin)) return cb(null, true);
        // Verified custom domains are served through the same-origin /api proxy and need no CORS.
        return cb(null, false);
      },
    }),
  );

  // Keep the raw body for callback signature verification.
  app.use(express.json({ limit: '2mb', verify: (req, _res, buf) => ((req as Request & { rawBody?: Buffer }).rawBody = buf) }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());
  app.use(sanitizeInput);

  app.use('/health', healthRoutes);
  app.use(h(resolveTenantHost));

  const api = express.Router();
  const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: env.NODE_ENV === 'test' ? 10_000 : 30, standardHeaders: true, legacyHeaders: false, message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' } } });
  const apiLimiter = rateLimit({ windowMs: 60_000, limit: env.NODE_ENV === 'test' ? 100_000 : 600, standardHeaders: true, legacyHeaders: false, message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } } });

  api.use(callbackRoutes); // public, verified per-endpoint (mounted before the generic limiter)
  api.use(mpesaPublicRouter); // public Safaricom callbacks, verified by secret per-tenant URL token
  api.use(platformMpesaPublicRouter); // public callbacks for AfeySync subscription payments
  api.use(apiLimiter);
  api.use('/auth/login', authLimiter);
  api.use('/auth/find-facility', authLimiter);
  api.use('/auth/handoff', authLimiter);
  api.use('/owner/auth/login', authLimiter);
  api.use('/auth/forgot-password', authLimiter);
  api.use('/auth/reset-password', authLimiter);
  api.use('/auth/google/start', authLimiter);
  api.use('/owner/auth/google/start', authLimiter);
  api.use('/auth/mfa/challenge', authLimiter);
  api.use('/onboarding/applications', authLimiter);
  api.use('/owner/auth/mfa/challenge', authLimiter);
  api.use(googleCallbackRouter);
  api.use('/auth', tenantAuthRoutes);
  api.use('/auth', selfServiceRoutes);
  api.use('/owner/auth', ownerAuthRoutes);
  api.use(onboardingPublicRouter);
  api.use(contactRouter);
  api.use(blogPublicRouter);
  api.use('/owner/blog', blogOwnerRouter);
  api.use('/owner/announcements', announcementOwnerRouter);
  api.use('/announcements', announcementTenantRouter);
  api.use('/owner/onboarding', onboardingOwnerRouter);
  api.use('/owner/plans', planOwnerRouter);
  api.use('/owner/billing', billingOwnerRouter);
  api.use('/owner/sms', smsOwnerRouter);
  api.use('/owner', ownerRoutes);
  api.use('/subscription', subscriptionRouter);
  api.use('/sms-wallet', smsWalletRouter);
  api.use('/diagnoses', diagnosisRoutes);
  api.use(requirePlanModule); // modules outside the facility's plan are refused
  api.use('/branches', branchRoutes);
  api.use('/users', usersRouter);
  api.use('/roles', rolesRouter);
  api.use('/permissions', permissionsRouter);
  api.use('/admin', adminRoutes);
  api.use('/patients', patientRoutes);
  api.use('/dha', dhaRoutes);
  api.use('/sha', shaVisitRoutes);
  api.use('/sha', shaClaimsRoutes);
  api.use('/sha', shaRoutes);
  api.use('/notifications', notificationRoutes);
  api.use('/dashboard', dashboardRoutes);
  api.use('/billing', billingRoutes);
  api.use('/visits', visitsRouter);
  api.use('/queues', queuesRouter);
  api.use('/referrals', referralsRouter);
  api.use('/appointments', appointmentRoutes);
  api.use('/opd', opdRouter);
  api.use('/consultations', consultationsRouter);
  api.use('/laboratory', labRoutes);
  api.use('/radiology', radiologyRoutes);
  api.use('/pharmacy', ePrescriptionRoutes);
  api.use('/pharmacy', pharmacyRoutes);
  api.use('/inventory', pharmacyRoutes);
  api.use('/procurement', procurementRoutes);
  api.use('/inpatient', inpatientRoutes);
  api.use('/maternity', maternityRouter);
  api.use('/mch', mchRouter);
  api.use('/family-planning', fpRouter);
  api.use('/dental', dentalRoutes);
  api.use('/mortuary', mortuaryRoutes);
  api.use('/documents', documentRoutes);
  api.use('/finance', financeRoutes);
  api.use('/hr', hrRoutes);
  api.use('/reports', reportRoutes);
  api.use('/fhir', fhirRoutes);
  api.use('/payments/mpesa', mpesaRouter);
  api.use('/insurance', insuranceRoutes);
  api.use('/integrations', insuranceRoutes); // /integrations/slade360/* aliases
  app.use('/api/v1', api);

  app.get('/api/docs/openapi.json', (_req, res) => res.json(openApiSpec));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, { customSiteTitle: 'AfeySync API' }));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
