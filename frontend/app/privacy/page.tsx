import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Relogue",
  description: "How Relogue collects, uses, and protects data.",
};

// Public, unauthenticated page (whitelisted in lib/auth.tsx + components/AppShell.tsx)
// so it can be linked from Meta's app configuration and reached without a login.
const LAST_UPDATED = "16 August 2026";

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-gray-800 dark:text-gray-200">
      <h1 className="text-3xl font-bold">Privacy Policy</h1>
      <p className="mt-2 text-sm text-gray-500">Last updated: {LAST_UPDATED}</p>

      <section className="mt-8 space-y-4 leading-relaxed">
        <p>
          Relogue provides a catering sales and operations platform (the
          &ldquo;Service&rdquo;) used by catering businesses (&ldquo;Customers&rdquo;)
          to manage leads, quotes, events, and client communications. This policy
          explains what data the Service handles, why, and the choices available to
          Customers and the people they interact with.
        </p>
        <p>
          For data that Customers enter or receive through the Service about their own
          clients, Relogue acts as a <strong>data processor</strong> on the
          Customer&rsquo;s behalf; the Customer is the controller of that data.
        </p>
      </section>

      <Section title="Information we collect">
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>Account &amp; staff data:</strong> names, email addresses, roles,
            and authentication credentials for the Customer&rsquo;s team members who
            use the Service.
          </li>
          <li>
            <strong>Business &amp; client data entered by the Customer:</strong>{" "}
            contacts, leads, venues, quotes, events, and related notes.
          </li>
          <li>
            <strong>Communications:</strong> messages the Customer sends to its own
            clients through the Service (email via the Customer&rsquo;s connected
            mailbox, and WhatsApp via our messaging provider), together with delivery
            status.
          </li>
          <li>
            <strong>Facebook &amp; Instagram data (only if the Customer connects a
            Page):</strong> lead-form submissions and direct messages from the
            Customer&rsquo;s own Facebook Pages and linked Instagram professional
            accounts, plus the Page and account identifiers and access tokens needed
            to receive them.
          </li>
        </ul>
      </Section>

      <Section title="How we use information">
        <ul className="list-disc space-y-2 pl-6">
          <li>To provide, operate, secure, and support the Service.</li>
          <li>
            To bring inquiries from connected channels (including Facebook and
            Instagram lead forms and messages) into the Customer&rsquo;s CRM so the
            Customer can respond to them.
          </li>
          <li>
            To send communications that the <em>Customer</em> initiates to its own
            clients. We never post, message, or advertise as a user on our own
            initiative.
          </li>
          <li>To generate optional AI-drafted follow-up suggestions, which a
            person on the Customer&rsquo;s team reviews before anything is sent.</li>
        </ul>
      </Section>

      <Section title="Meta Platform data">
        <p>
          When a Customer connects a Facebook Page or Instagram account, Relogue
          receives lead-form and message data <em>on that Customer&rsquo;s behalf</em>{" "}
          to deliver it into their CRM. We request only the permissions needed for
          that purpose. Access tokens are stored <strong>encrypted at rest</strong>{" "}
          and are never exposed to the browser or shared with third parties. We do not
          sell this data, use it for advertising, or use it to build profiles beyond
          delivering the inquiry to the connecting Customer. Our use of information
          received from Meta APIs follows Meta&rsquo;s Platform Terms and Developer
          Policies.
        </p>
      </Section>

      <Section title="Service providers">
        <p>
          We share data only with the processors that run the Service, and only as
          needed to operate it:
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li><strong>Meta Platforms</strong> — Facebook/Instagram lead and messaging integration.</li>
          <li><strong>Google / Microsoft</strong> — sending email through a Customer&rsquo;s connected mailbox (send-only access).</li>
          <li><strong>Twilio</strong> — WhatsApp message delivery.</li>
          <li><strong>Stripe</strong> — subscription billing.</li>
          <li><strong>Anthropic</strong> — generating optional AI follow-up drafts.</li>
          <li><strong>DigitalOcean</strong> — application hosting and database.</li>
        </ul>
      </Section>

      <Section title="Data retention">
        <p>
          We retain data for as long as the Customer&rsquo;s account is active or as
          needed to provide the Service, and then delete or anonymize it within a
          reasonable period, unless a longer retention is required by law.
        </p>
      </Section>

      <Section title="Your choices &amp; data deletion">
        <p>
          A Customer can disconnect any Facebook Page or Instagram account at any time
          from <strong>Settings → Integrations</strong>; doing so removes our stored
          access tokens for that Page and ends our access to its data.
        </p>
        <p className="mt-3">
          To request access to, correction of, or deletion of data held about you,
          email{" "}
          <a className="text-blue-600 underline dark:text-blue-400" href="mailto:privacy@relogue.com">
            privacy@relogue.com
          </a>
          . If you contacted a catering business through their Facebook or Instagram
          Page, that business is the controller of your data; we will route deletion
          requests to them and delete the corresponding records we hold as their
          processor.
        </p>
      </Section>

      <Section title="Security">
        <p>
          We use industry-standard safeguards, including encryption in transit and
          encryption at rest for sensitive credentials such as connected-account
          access tokens. No method of transmission or storage is completely secure,
          but we work to protect data commensurate with its sensitivity.
        </p>
      </Section>

      <Section title="Cookies">
        <p>
          We use strictly necessary cookies to keep users signed in and to secure the
          Service. We do not use advertising or cross-site tracking cookies.
        </p>
      </Section>

      <Section title="Children">
        <p>
          The Service is intended for business use and is not directed to children,
          and we do not knowingly collect data from children.
        </p>
      </Section>

      <Section title="Changes to this policy">
        <p>
          We may update this policy from time to time. Material changes will be
          reflected by updating the &ldquo;Last updated&rdquo; date above.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions about this policy or our data practices? Email{" "}
          <a className="text-blue-600 underline dark:text-blue-400" href="mailto:privacy@relogue.com">
            privacy@relogue.com
          </a>
          .
        </p>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="mt-3 space-y-3 leading-relaxed">{children}</div>
    </section>
  );
}
