import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/PageHeader";
import { TRUST_CONTACT_EMAIL } from "@/config/app";

export const metadata: Metadata = {
  title: "Privacy & Security",
  description: "How Maverick Personal handles financial data connected through Plaid.",
};

const EFFECTIVE = "October 9, 2026";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="flex flex-col gap-3 text-zinc-700 dark:text-zinc-300">{children}</div>
    </section>
  );
}

export default function TrustPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
      <PageHeader title="Privacy & Security" subtitle={`How financial data is collected, used and protected. Effective ${EFFECTIVE}.`} />
      <div className="flex flex-col gap-10 leading-relaxed">
        <Section title="About this app">
          <p>
            Maverick Personal is a private personal-finance and life-management app built and operated by Victor Moore for his own use. It
            is not offered to the public and has no other users. The only person whose financial data it handles is its owner.
          </p>
        </Section>

        <Section title="Information collected through Plaid">
          <p>
            The app uses Plaid Inc. to connect the owner&apos;s bank, credit card and loan accounts. When an account is connected, the app
            receives:
          </p>
          <ul className="list-disc pl-6">
            <li>Account names, types and the last four digits of account numbers</li>
            <li>Current account balances</li>
            <li>Transactions: date, amount, merchant or description, and category</li>
          </ul>
          <p>
            Bank usernames and passwords are entered directly into Plaid&apos;s secure window. This app never sees, receives or stores them.
            Plaid&apos;s handling of data is described in the{" "}
            <a href="https://plaid.com/legal/#end-user-privacy-policy" className="text-brand underline underline-offset-2" target="_blank" rel="noopener noreferrer">
              Plaid End User Privacy Policy
            </a>
            .
          </p>
        </Section>

        <Section title="How the information is used">
          <p>
            Financial data is used only to show the owner his own balances, spending, budgets and upcoming bills inside this app. It is never
            sold, rented, shared with third parties, used for advertising, or used to make credit or lending decisions.
          </p>
        </Section>

        <Section title="How the information is protected">
          <ul className="list-disc pl-6">
            <li>All traffic between the browser, the app&apos;s servers and Plaid is encrypted in transit with HTTPS (TLS).</li>
            <li>
              Plaid API keys are used only by server code. They are kept either as encrypted environment variables on the hosting provider (Vercel), or on the owner&apos;s device in a form sealed with AES-256-GCM that only the server can open.
              They are never sent to the browser.
            </li>
            <li>
              The access token for each connected account is encrypted with AES-256-GCM on the server before it is stored, and can only be
              used through the app&apos;s own server.
            </li>
            <li>
              Financial data is kept in the owner&apos;s own browser storage rather than in a shared database, so there is no central store of
              financial records to breach.
            </li>
            <li>Every page and server function of the app, other than this policy, requires the owner&apos;s password. Sessions are held in a secure, HTTP-only cookie.</li>
            <li>Saved logins in the app&apos;s vault are encrypted on the device with AES-256, using a key derived from a master password.</li>
          </ul>
        </Section>

        <Section title="Consent">
          <p>
            Each account is connected only when the owner chooses to link it through Plaid, which asks for consent before any data is shared.
          </p>
        </Section>

        <Section title="Keeping and deleting data">
          <p>
            Data is kept only as long as the owner keeps it. Disconnecting an account in the app revokes the app&apos;s access to it at Plaid
            and stops all further updates. Clearing the app&apos;s data in the browser deletes the stored financial records and connections.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p>If these practices change, this page will be updated and the effective date above will change.</p>
        </Section>

        {TRUST_CONTACT_EMAIL && (
          <Section title="Contact">
            <p>
              Questions about this policy can be sent to{" "}
              <a href={`mailto:${TRUST_CONTACT_EMAIL}`} className="text-brand underline underline-offset-2">
                {TRUST_CONTACT_EMAIL}
              </a>
              .
            </p>
          </Section>
        )}
      </div>
    </main>
  );
}
