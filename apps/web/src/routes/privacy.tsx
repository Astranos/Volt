import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { SiteFooter, SiteHeader, supportUrl } from "../site-chrome";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      {
        name: "description",
        content: "Privacy policy for the Volt Scanner app and Chrome extension.",
      },
    ],
    title: "Privacy Policy - Volt",
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:py-24">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-green-700">
          Volt Scanner
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
          Privacy Policy
        </h1>
        <p className="mt-4 text-sm text-zinc-500">Effective July 22, 2026</p>

        <div className="mt-12 space-y-10 text-base leading-7 text-zinc-700">
          <PolicySection title="What Volt processes">
            <p>
              Volt processes account and workspace identifiers supplied by Clerk,
              anonymous trial identifiers, scanner session metadata, subscription
              status, and the captures you choose to sync. Synced captures may
              include text, barcodes, dictated notes, and photos.
            </p>
          </PolicySection>

          <PolicySection title="How information is used">
            <p>
              Information is used to authenticate you, pair the iPhone app or App
              Clip with the Chrome extension, synchronize your private scanner
              workspace, enforce service limits, restore purchases, prevent abuse,
              and operate and improve Volt.
            </p>
          </PolicySection>

          <PolicySection title="Storage and service providers">
            <p>
              Account authentication is provided by Clerk. Workspace records and
              access state are stored with Convex. Private cloud photos are stored
              in a non-public Cloudflare R2 bucket and are accessed through
              short-lived signed URLs. Apple processes App Store purchases, and
              Vercel hosts Volt&apos;s public website. These providers process data
              under their own terms and privacy commitments.
            </p>
          </PolicySection>

          <PolicySection title="Pairing and device access">
            <p>
              Live scanner control uses an encrypted WebRTC connection between
              your devices. Volt&apos;s signaling service exchanges the limited
              connection metadata needed to establish that session. When cloud
              sync is enabled, captures you send are also copied to your authenticated
              workspace so they can appear on your other devices.
            </p>
          </PolicySection>

          <PolicySection title="Sharing and sale of data">
            <p>
              Volt does not sell your personal information. Information is shared
              only with the service providers needed to operate Volt, when you direct
              us to share it, or when disclosure is required by law or necessary to
              protect the service and its users.
            </p>
          </PolicySection>

          <PolicySection title="Your choices">
            <p>
              You control which captures are sent to Volt and can delete results
              from the workspace interface. You can manage or cancel a Volt Pro
              subscription through your Apple Account. To request access to or
              deletion of account data, contact us through the support link below.
            </p>
          </PolicySection>

          <PolicySection title="Security and retention">
            <p>
              Volt uses scoped credentials, authenticated workspace boundaries,
              private object storage, and encrypted transport to protect data. Data
              is retained while needed to provide the service, resolve disputes,
              meet legal obligations, and maintain security. No system can guarantee
              absolute security.
            </p>
          </PolicySection>

          <PolicySection title="Children and changes">
            <p>
              Volt is not directed to children under 13. We may update this policy
              as the service changes; the effective date above identifies the latest
              version.
            </p>
          </PolicySection>

          <PolicySection title="Contact">
            <p>
              Questions and privacy requests can be submitted through{` `}
              <a className="font-semibold text-green-700 underline" href={supportUrl}>
                Volt support
              </a>
              .
            </p>
          </PolicySection>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function PolicySection({
  children,
  title,
}: Readonly<{ children: ReactNode; title: string }>) {
  return (
    <section>
      <h2 className="text-xl font-semibold text-zinc-950">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}
