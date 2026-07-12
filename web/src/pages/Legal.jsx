import { Link } from 'react-router-dom';

/**
 * Public legal page: electronic-signature consent/disclosure, terms of use, and
 * a privacy summary. Linked from the app footer, the signing page, and auth
 * pages. This is a starting template — have counsel review before relying on it.
 */
export default function Legal() {
  return (
    <div className="public-wrap" style={{ textAlign: 'left', maxWidth: 820 }}>
      <div className="brand" style={{ padding: '0 0 16px' }}>
        <span>DocSign</span>
      </div>
      <h1>Legal &amp; Electronic Signature Disclosure</h1>
      <p className="muted">Last updated: 12 July 2026</p>

      <div className="card mb" style={{ background: '#fffbeb', borderColor: '#f6e0bd' }}>
        <strong>Please note:</strong> this page is a general starting template, not legal advice. Have a
        qualified lawyer review and adapt it for your jurisdiction and use before relying on it.
      </div>

      <h2>1. Consent to sign electronically</h2>
      <p>
        By signing a document through this service, you agree to conduct the transaction electronically and
        that your electronic signature (whether typed or drawn) is the legal equivalent of your handwritten
        signature and is binding on you. You confirm you intend to sign and are authorised to do so.
      </p>
      <p>
        Electronic signatures are recognised under laws including the U.S. ESIGN Act and UETA, the EU eIDAS
        Regulation (as a simple electronic signature), and the UK Electronic Communications Act / UK eIDAS.
        You may request a paper (wet-ink) alternative from the party who sent you the document if you prefer
        not to sign electronically.
      </p>

      <h2>2. Identity, records &amp; audit trail</h2>
      <p>
        We verify a signer's identity by a one-time email code or by an authenticated account login. Each
        completed document is finalised with a Certificate of Completion and a tamper-evident, hash-chained
        audit trail recording who signed, when, and from where. A copy of the completed document is made
        available to the parties. Please retain your copy — it is your evidence of the agreement.
      </p>

      <h2>3. Appropriate use</h2>
      <p>
        This service is intended for ordinary business documents (e.g. NDAs, agreements, letters). It should
        <strong> not</strong> be used for documents that require wet-ink signature or notarisation under
        applicable law — for example wills, certain family-law documents, some property/title deeds, and some
        court filings. It provides a <em>simple/standard</em> electronic signature and does not provide a
        qualified/advanced certificate-based signature under eIDAS.
      </p>

      <h2>4. Terms of use</h2>
      <p>
        You are responsible for the documents you upload and send, for having the right to send them, and for
        the accuracy of recipient details. Do not use the service unlawfully or to send content you are not
        authorised to share. The service is provided "as is" without warranties; to the extent permitted by
        law, the operator is not liable for indirect or consequential loss arising from use of the service.
      </p>

      <h2>5. Privacy</h2>
      <p>
        To provide the service we process personal data including names, email addresses, IP addresses,
        signatures, and the documents and metadata involved. Where applicable law (such as the EU/UK GDPR)
        applies, our lawful basis is performance of a contract and our legitimate interest in providing the
        service. We retain completed documents and audit records for as long as needed to provide the service
        and to meet legal/record-keeping obligations (commonly 6–7 years). Documents may be end-to-end
        encrypted, in which case the operator cannot read their contents. You may request access to, or
        deletion of, your personal data by contacting the party who sent you the document, or the operator.
      </p>

      <h2>6. Contact</h2>
      <p>
        Questions about signing, your data, or this notice: contact the sender of your document, or the
        service operator at the address shown in the email you received.
      </p>

      <p className="mt">
        <Link to="/login">Back to sign in</Link>
      </p>
    </div>
  );
}
