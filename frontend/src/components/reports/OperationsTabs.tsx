import { Link } from 'react-router-dom';
import {
  CheckCircle,
  Clock,
  Coins,
  Hourglass,
  Lifebuoy,
  Receipt,
  Scales,
  SealCheck,
  WarningCircle,
  XCircle,
} from '@phosphor-icons/react';
import { CASE_STATUS_LABEL, VERIFICATION_LABEL, type VerificationStatus } from '../../lib/permissions';
import { BarList, DataTable, KpiGrid, KpiTile, Panel, Stat } from './ReportParts';
import {
  APPLICANT_LABEL,
  CASE_SUBJECT_LABEL,
  DISPUTE_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  count,
  hours,
  inr,
  titleCase,
  type ReportsData,
} from './reportData';

/** Every transaction in the period, by outcome and by where the money sits (EZ1-I242). */
export function PaymentsTab({ d }: { d: ReportsData }) {
  const p = d.payments.data;
  const a = p?.amounts;

  return (
    <div className="space-y-6">
      <KpiGrid>
        <KpiTile label="Transactions" value={count(p?.transactions)} to="/admin/payments" icon={Receipt}
          accent="brand" load={d.payments} />
        <KpiTile label="Successful" hint="Money taken" value={count(p?.successful)} icon={CheckCircle}
          accent="positive" load={d.payments} />
        <KpiTile label="Failed or not completed" hint={`${count(p?.failed)} failed, ${count(p?.pending)} not yet paid`}
          value={count((p?.failed ?? 0) + (p?.pending ?? 0))} to="/admin/payments?status=failed" icon={XCircle}
          accent="critical" load={d.payments} />
        <KpiTile label="Refunded or disputed" hint={`${count(p?.refunded)} refunded, ${count(p?.disputed)} disputed`}
          value={count((p?.refunded ?? 0) + (p?.disputed ?? 0))} to="/admin/payments?status=disputed" icon={Scales}
          accent="caution" load={d.payments} />
      </KpiGrid>

      <Panel title="Escrow position" subtitle="Payments taken in this period. Each figure opens those payments." icon={Coins}
        load={d.payments} empty={!p?.transactions} emptyText="No payments in this period.">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Collected" value={inr(a?.collected)} to="/admin/payments" />
          <Stat label="Held in escrow" value={inr(a?.held)} to="/admin/payments?status=held_in_escrow" />
          <Stat label="Released to providers" value={inr(a?.released)} to="/admin/payments?status=released" />
          <Stat label="Platform commission" value={inr(a?.commission)} to="/admin/payments?status=released" />
          <Stat label="Awaiting payout" value={inr(a?.awaitingPayout)} to="/admin/payments?status=pending_payout" />
          <Stat label="Disputed" value={inr(a?.disputed)} to="/admin/payments?status=disputed" />
          <Stat label="Refunded" value={inr(a?.refunded)} to="/admin/payments?status=refunded" />
          <Stat label="Partially settled" value={inr(a?.partiallySettled)} to="/admin/payments?status=partially_settled" />
        </div>
      </Panel>

      <Panel title="Payments by status" subtitle="Each status opens its payments." icon={Receipt} load={d.payments}
        empty={!p?.transactions} emptyText="No payments in this period.">
        <BarList accent="caution" rows={Object.entries(p?.byStatus ?? {}).map(([status, v]) => ({
          key: status,
          label: PAYMENT_STATUS_LABEL[status] ?? titleCase(status),
          value: v.count,
          display: `${count(v.count)} · ${inr(v.amount)}`,
          to: `/admin/payments?status=${status}`,
        }))} />
      </Panel>
    </div>
  );
}

/** Verification raised in the period, and the officers' queues today (EZ1-I242). */
export function VerificationTab({ d }: { d: ReportsData }) {
  const v = d.verification.data;
  const types = Object.entries(v?.byApplicantType ?? {});

  return (
    <div className="space-y-6">
      <KpiGrid>
        <KpiTile label="Verification requests" value={count(v?.requests)} to="/verification" icon={SealCheck}
          accent="positive" load={d.verification} />
        <KpiTile label="Waiting for an officer" value={count(v?.pending)} to="/verification" icon={Hourglass}
          accent="caution" load={d.verification} />
        <KpiTile label="Approved" hint={`${count(v?.rejected)} rejected`} value={count(v?.approved)} icon={CheckCircle}
          accent="positive" load={d.verification} />
        <KpiTile label="Typical time to a decision" hint="Median, over requests decided" value={hours(v?.medianHoursToDecision ?? null)}
          icon={Clock} accent="brand" load={d.verification} />
      </KpiGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Requests by status" icon={SealCheck} load={d.verification} empty={!v?.requests}
          emptyText="No verification was requested in this period.">
          <BarList accent="positive" rows={Object.entries(v?.byStatus ?? {})
            .filter(([, n]) => n > 0)
            .map(([status, n]) => ({ key: status, label: VERIFICATION_LABEL[status as VerificationStatus] ?? titleCase(status), value: n }))} />
        </Panel>

        <Panel title="By applicant" subtitle="Who was being verified, and how it went." icon={SealCheck}
          load={d.verification} empty={!v?.requests} emptyText="No verification was requested in this period.">
          <DataTable rows={types} rowKey={([t]) => t} columns={[
            { key: 'type', label: 'Applicant', render: ([t]) => APPLICANT_LABEL[t] ?? titleCase(t) },
            { key: 'requests', label: 'Requests', align: 'right', render: ([, r]) => count(r.requests) },
            { key: 'approved', label: 'Approved', align: 'right', render: ([, r]) => count(r.approved) },
            { key: 'rejected', label: 'Rejected', align: 'right', render: ([, r]) => count(r.rejected) },
            { key: 'pending', label: 'Still open', align: 'right', render: ([, r]) => count(r.pending) },
          ]} />
        </Panel>
      </div>

      <Panel title="Officer workload" subtitle="Requests allocated and still open, whatever the period. Each officer opens their record."
        icon={Hourglass} load={d.verification} empty={!v?.officerWorkload.length}
        emptyText="No officer is carrying an open request.">
        <BarList accent="positive" rows={(v?.officerWorkload ?? []).map((o) => ({
          key: o.officerId,
          label: o.email ?? 'An officer',
          value: o.open,
          display: `${count(o.open)} open`,
          to: `/admin/officers/${o.officerId}`,
        }))} />
      </Panel>
    </div>
  );
}

/** Support cases and disputes raised in the period, kept apart (EZ1-I242). */
export function SupportTab({ d }: { d: ReportsData }) {
  const s = d.support.data;

  return (
    <div className="space-y-6">
      <KpiGrid>
        <KpiTile label="Cases raised" hint={`${count(s?.unresolved)} not yet resolved`} value={count(s?.cases)}
          to="/admin/support?tab=cases" icon={Lifebuoy} accent="critical" load={d.support} />
        <KpiTile label="Open cases" hint="Not yet picked up" value={count(s?.open)}
          to="/admin/support?tab=cases&status=open" icon={WarningCircle} accent="critical" load={d.support} />
        <KpiTile label="Disputes raised" hint={`${count(s?.openDisputes)} still open`} value={count(s?.disputes)}
          to="/admin/support?tab=disputes" icon={Scales} accent="caution" load={d.support} />
        <KpiTile label="Typical time to resolve" hint="Median, over cases resolved" value={hours(s?.medianHoursToResolution ?? null)}
          icon={Clock} accent="brand" load={d.support} />
      </KpiGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Cases by status" subtitle="Each status opens those cases." icon={Lifebuoy} load={d.support}
          empty={!s?.cases} emptyText="No support cases were raised in this period.">
          <BarList accent="critical" rows={Object.entries(s?.caseByStatus ?? {})
            .filter(([, n]) => n > 0)
            .map(([status, n]) => ({
              key: status,
              label: CASE_STATUS_LABEL[status] ?? titleCase(status),
              value: n,
              to: `/admin/support?tab=cases&status=${status}`,
            }))} />
        </Panel>

        <Panel title="What the cases are about" icon={Lifebuoy} load={d.support} empty={!s?.cases}
          emptyText="No support cases were raised in this period.">
          <BarList accent="caution" rows={Object.entries(s?.bySubject ?? {})
            .filter(([, n]) => n > 0)
            .sort((x, y) => y[1] - x[1])
            .map(([subject, n]) => ({ key: subject, label: CASE_SUBJECT_LABEL[subject] ?? titleCase(subject), value: n }))} />
        </Panel>
      </div>

      <Panel title="Disputes by status" subtitle="A dispute is a buyer contesting a booking. Counted apart from cases, never with them."
        icon={Scales} load={d.support} empty={!s?.disputes} emptyText="No disputes were raised in this period."
        action={<Link to="/admin/support?tab=disputes" className="text-sm text-brand-strong hover:underline">Open disputes</Link>}>
        <BarList accent="caution" rows={Object.entries(s?.disputeByStatus ?? {}).map(([status, n]) => ({
          key: status,
          label: DISPUTE_STATUS_LABEL[status] ?? titleCase(status),
          value: n,
        }))} />
      </Panel>
    </div>
  );
}
