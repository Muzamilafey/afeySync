import { ImageResponse } from 'next/og';

export const alt = 'AfeySync: hospital management system for Kenyan hospitals and clinics';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** The picture shown when afey.co.ke is shared on WhatsApp, Facebook, LinkedIn or X. */
export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 72, background: 'linear-gradient(135deg, #062f29 0%, #0a6e5c 55%, #0fa588 100%)', color: 'white' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ width: 72, height: 72, borderRadius: 18, background: 'rgba(255,255,255,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40 }}>+</div>
          <div style={{ fontSize: 44, fontWeight: 700 }}>AfeySync</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.1, maxWidth: 980 }}>Run your whole facility in one secure system.</div>
          <div style={{ marginTop: 24, fontSize: 30, color: 'rgba(236,253,248,0.85)' }}>OPD · Lab · Pharmacy · Wards · Maternity · Billing · M-Pesa · SHA</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 28, color: 'rgba(236,253,248,0.85)' }}>
          <span>afey.co.ke</span>
          <span>0722 651 888 · info@afey.co.ke</span>
        </div>
      </div>
    ),
    size,
  );
}
