import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Reserva tu cita',
  description: 'Reserva, consulta, reprograma o cancela tu cita en la peluquería.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-ES">
      <body>{children}</body>
    </html>
  );
}
