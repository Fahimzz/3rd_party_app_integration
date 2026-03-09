import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Jira Integration MVP',
  description: 'Minimal Jira ticket creation app',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
