import { Link } from 'react-router-dom';

/**
 * Public privacy policy (controller-facing, for DocSign account holders). Linked
 * from the footer. Starting template — have counsel review before relying on it.
 */
export default function Privacy() {
  return (
    <div className="public-wrap" style={{ textAlign: 'left', maxWidth: 820 }}>
      <div className="brand" style={{ padding: '0 0 16px' }}>
        <span>DocSign</span>
      </div>
      <h1>Privacy Policy</h1>
      <p className="muted">Last updated: 12 July 2026</p>

      <div className="card mb" style={{ background: '#fffbeb', borderColor: '#f6e0bd' }}>
        <strong>Please note:</strong> this is a general starting template, not legal advice. Have a
        qualified lawyer review and adapt it for your jurisdiction before relying on it.
      </div>

      <h2>1. Who we are</h2>
      <p>
        DocSign ("the Service") is an electronic signature and document-sharing service operated by
        [Cryptool / your legal entity], the "controller" of the personal data described here. Contact:
        [your contact email].
      </p>

      <h2>2. What we collect</h2>
      <ul>
        <li><strong>Account data</strong> — name, email, company, password (hashed).</li>
        <li><strong>Signing data</strong> — signer names, emails, IP addresses, signatures (typed/drawn), and the timestamps and events in the audit trail.</li>
        <li><strong>Documents</strong> — the files you upload and send. These may be end-to-end encrypted, in which case we cannot read their contents.</li>
        <li><strong>Usage data</strong> — view/open analytics for tracked share links, and basic technical logs.</li>
      </ul>

      <h2>3. Why we process it (lawful basis)</h2>
      <ul>
        <li><strong>To provide the Service</strong> — performance of our contract with you (Art. 6(1)(b)).</li>
        <li><strong>Evidence &amp; audit trail</strong> — our legitimate interest and legal obligation to keep a reliable record of signed agreements (Art. 6(1)(c)/(f)).</li>
        <li><strong>Security &amp; abuse prevention</strong> — legitimate interest.</li>
      </ul>

      <h2>4. Sharing &amp; sub-processors</h2>
      <p>
        We do not sell your data. We share it only with the service providers needed to run DocSign — for
        example cloud hosting and database (our server host), and email delivery (Amazon SES) — each bound to
        protect it. When you send from your own connected mailbox (Gmail/Outlook), delivery happens through
        that provider under their terms.
      </p>

      <h2>5. Retention</h2>
      <p>
        Completed agreements and their audit trail are retained for the period required to provide the Service
        and meet legal obligations (commonly 6–7 years). Unsent drafts are automatically purged after a short
        window. When you delete your account we erase your personal data and anonymize your record, keeping
        only completed agreements required for legal retention.
      </p>

      <h2>6. Security</h2>
      <p>
        Data is encrypted in transit (TLS) and at rest. Documents can be end-to-end encrypted so that even we
        cannot read them. Access is controlled by authentication and role-based permissions.
      </p>

      <h2>7. International transfers</h2>
      <p>
        Where data is transferred outside your region, we rely on appropriate safeguards (such as Standard
        Contractual Clauses). [Confirm your hosting/email regions here.]
      </p>

      <h2>8. Your rights</h2>
      <p>
        Subject to law, you may request access to, correction of, a copy of, or deletion of your personal
        data, and may object to or restrict certain processing. You can delete your account and personal data
        from <strong>Settings → Delete account</strong>, or contact us at [your contact email]. Note that the
        right to erasure does not extend to records we must retain for legal reasons. You may also complain to
        your data protection authority.
      </p>

      <h2>9. Cookies</h2>
      <p>
        We use only the cookies necessary to keep you signed in and secure the Service. We do not use
        advertising cookies.
      </p>

      <p className="mt">
        See also our <Link to="/legal">Legal &amp; e-signature disclosure</Link> and{' '}
        <Link to="/dpa">Data Processing Agreement</Link>.
      </p>
    </div>
  );
}
