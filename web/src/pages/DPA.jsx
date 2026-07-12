import { Link } from 'react-router-dom';

/**
 * Public Data Processing Agreement (processor terms for business customers who
 * send documents through DocSign). Linked from the footer. Starting template —
 * have counsel review before relying on it.
 */
export default function DPA() {
  return (
    <div className="public-wrap" style={{ textAlign: 'left', maxWidth: 820 }}>
      <div className="brand" style={{ padding: '0 0 16px' }}>
        <span>DocSign</span>
      </div>
      <h1>Data Processing Agreement</h1>
      <p className="muted">Last updated: 12 July 2026</p>

      <div className="card mb" style={{ background: '#fffbeb', borderColor: '#f6e0bd' }}>
        <strong>Please note:</strong> this is a general starting template, not legal advice. Have a
        qualified lawyer review and adapt it before offering it to customers.
      </div>

      <p>
        This Data Processing Agreement ("DPA") forms part of the agreement between the customer ("Controller")
        and [Cryptool / your legal entity] ("Processor") for use of the DocSign service ("Service"). It applies
        where the Processor processes personal data on the Controller's behalf under the EU/UK GDPR or similar
        laws.
      </p>

      <h2>1. Roles</h2>
      <p>
        The Controller determines the purposes and means of processing the personal data it submits to the
        Service. The Processor processes that data only on the Controller's documented instructions (including
        via use of the Service), except where required by law.
      </p>

      <h2>2. Subject matter &amp; details</h2>
      <ul>
        <li><strong>Subject matter:</strong> provision of electronic signature and document-sharing.</li>
        <li><strong>Duration:</strong> for the term of the agreement plus applicable retention periods.</li>
        <li><strong>Nature &amp; purpose:</strong> storing, transmitting, and processing documents and signer data to obtain and evidence signatures.</li>
        <li><strong>Categories of data subjects:</strong> the Controller's signers, recipients, and users.</li>
        <li><strong>Types of data:</strong> names, email addresses, IP addresses, signatures, document contents and metadata.</li>
      </ul>

      <h2>3. Processor obligations</h2>
      <ul>
        <li>Process only on documented instructions; notify the Controller if an instruction appears unlawful.</li>
        <li>Ensure personnel are bound by confidentiality.</li>
        <li>Implement appropriate technical and organizational security (encryption in transit and at rest; optional end-to-end encryption; access controls).</li>
        <li>Assist the Controller in responding to data-subject requests and in meeting its security, breach-notification, and impact-assessment obligations.</li>
        <li>Notify the Controller without undue delay after becoming aware of a personal data breach.</li>
        <li>At the Controller's choice, delete or return personal data at the end of the services, except where retention is legally required.</li>
        <li>Make available information necessary to demonstrate compliance and allow for reasonable audits.</li>
      </ul>

      <h2>4. Sub-processors</h2>
      <p>
        The Controller authorizes the Processor to engage sub-processors to provide the Service (e.g. cloud
        hosting/database and email delivery such as Amazon SES). The Processor imposes data-protection terms on
        each sub-processor no less protective than this DPA and remains responsible for their performance. A
        current list is available on request; the Processor will give notice of intended changes.
      </p>

      <h2>5. International transfers</h2>
      <p>
        Where personal data is transferred outside the EEA/UK, the parties rely on an appropriate transfer
        mechanism, such as the EU Standard Contractual Clauses (and the UK Addendum), which are incorporated by
        reference where applicable.
      </p>

      <h2>6. Liability &amp; precedence</h2>
      <p>
        This DPA is subject to the liability provisions of the main agreement. In case of conflict on data
        protection matters, this DPA prevails.
      </p>

      <p className="mt">
        See also our <Link to="/privacy">Privacy Policy</Link> and{' '}
        <Link to="/legal">Legal &amp; e-signature disclosure</Link>.
      </p>
    </div>
  );
}
