import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { IconPlus, IconCopy, IconQrcode, IconCheck, IconChartBar, IconClockQuestion, IconCalendarEvent, IconTrophy } from '@tabler/icons-react';
import type { DashboardData } from '@/hooks/useDashboardData';
import { useEntityCrud } from '@/components/EntityCrud';
import { flowActionFor } from '@/config/plan';
import type { EnrichedUmfragen } from '@/types/enriched';
import type { Terminvorschlaege, Antworten } from '@/types/app';
import { extractRecordId } from '@/services/livingAppsService';
import { lookupKey } from '@/lib/formatters';
import { useClock, gruss, undoToast } from '@/lib/polish';
import { tx, dateFnsLocale } from '@/i18n';
import { DashboardGrid } from '@/components/DashboardGrid';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import { WorkList } from '@/components/WorkList';
import { Button } from '@/components/ui/button';
import { usePublicPageLink } from '@/components/widgets/PublicPageQr';
import { qrSvgString } from '@/components/widgets/QrCode';

interface TermStat {
  t: Terminvorschlaege;
  ja: number;
  vielleicht: number;
  best: boolean;
}

interface PollStat {
  u: EnrichedUmfragen;
  open: boolean;
  terms: TermStat[];
  participants: number;
  finalId: string | null;
  bestId: string | null;
}

function fmtTerm(t: Terminvorschlaege): string {
  const loc = { locale: dateFnsLocale() };
  const b = t.fields.beginn ? parseISO(t.fields.beginn) : null;
  const e = t.fields.ende ? parseISO(t.fields.ende) : null;
  if (!b) return '—';
  const start = format(b, 'EEE dd.MM. HH:mm', loc);
  if (!e) return start;
  return format(e, 'yyyy-MM-dd') === format(b, 'yyyy-MM-dd')
    ? `${start}–${format(e, 'HH:mm')}`
    : `${start} – ${format(e, 'EEE dd.MM. HH:mm', loc)}`;
}

function ShareButtons({ recordId }: { recordId: string }) {
  const { link } = usePublicPageLink('umfragen', recordId);
  if (!link) return <span className="text-xs text-muted-foreground">{tx('Teilnahmelink noch nicht veröffentlicht')}</span>;
  const copy = () => {
    void navigator.clipboard?.writeText(link);
    undoToast(tx('Link kopiert'));
  };
  const openQr = () => {
    const url = URL.createObjectURL(new Blob([qrSvgString(link, { margin: 4 })], { type: 'image/svg+xml' }));
    window.open(url, '_blank', 'noopener');
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={copy}><IconCopy size={16} className="shrink-0" />{tx('Link kopieren')}</Button>
      <Button variant="outline" size="sm" onClick={openQr}><IconQrcode size={16} className="shrink-0" />{tx('QR-Code öffnen')}</Button>
    </div>
  );
}

export default function DashboardOverview({ data }: { data: DashboardData }) {
  const { umfragen, terminvorschlaege, antworten } = data;
  const clock = useClock();
  const [filter, setFilter] = useState<'all' | 'open' | 'pending'>('all');

  // One write path for "set final date + close": the owning flow (one click).
  const finalize = (u: EnrichedUmfragen, terminId: string) => {
    const go = flowActionFor('umfragen', 'finaler_termin', u.record_id, terminId);
    return go ?? (() => crud.umfragen.openEdit(u));
  };

  const crud = useEntityCrud(data, {
    footer: (top) => {
      if (top.type !== 'umfragen') return undefined;
      const p = polls.find(x => x.u.record_id === top.record.record_id);
      if (!p || !p.open || !p.bestId) return undefined;
      return { label: tx('Besten Termin festlegen & schließen'), onClick: finalize(p.u, p.bestId) };
    },
  });
  const enrichedUmfragen = crud.enriched.umfragen;

  const polls: PollStat[] = useMemo(() => {
    const ans = new Map<string, Antworten[]>();
    for (const a of antworten) {
      const id = extractRecordId(a.fields.umfrage);
      if (id) ans.set(id, [...(ans.get(id) ?? []), a]);
    }
    const terms = new Map<string, Terminvorschlaege[]>();
    for (const t of terminvorschlaege) {
      const id = extractRecordId(t.fields.umfrage);
      if (id) terms.set(id, [...(terms.get(id) ?? []), t]);
    }
    return [...enrichedUmfragen]
      .sort((a, b) => (b.createdat ?? '').localeCompare(a.createdat ?? ''))
      .map(u => {
        const mine = ans.get(u.record_id) ?? [];
        const stats: TermStat[] = (terms.get(u.record_id) ?? [])
          .sort((a, b) => (a.fields.beginn ?? '').localeCompare(b.fields.beginn ?? ''))
          .map(t => {
            const forT = mine.filter(a => extractRecordId(a.fields.terminvorschlag) === t.record_id);
            return {
              t,
              ja: forT.filter(a => lookupKey(a.fields.antwort) === 'ja').length,
              vielleicht: forT.filter(a => lookupKey(a.fields.antwort) === 'vielleicht').length,
              best: false,
            };
          });
        const max = Math.max(0, ...stats.map(s => s.ja));
        const winner = max > 0 ? stats.find(s => s.ja === max) : undefined;
        stats.forEach(s => { s.best = max > 0 && s.ja === max; });
        const names = new Set(mine.map(a => `${a.fields.teilnehmer_vorname ?? ''} ${a.fields.teilnehmer_nachname ?? ''}`.trim().toLowerCase()));
        return {
          u,
          open: lookupKey(u.fields.status) !== 'geschlossen',
          terms: stats,
          participants: names.size,
          finalId: extractRecordId(u.fields.finaler_termin),
          bestId: winner?.t.record_id ?? null,
        };
      });
  }, [enrichedUmfragen, terminvorschlaege, antworten]);

  const openPolls = polls.filter(p => p.open);
  const pending = openPolls.filter(p => !p.finalId);
  const noAnswers = openPolls.filter(p => p.participants === 0);
  const shown = polls.filter(p => filter === 'all' ? true : filter === 'open' ? p.open : p.open && !p.finalId);

  const titles = pending.slice(0, 2).map(p => p.u.fields.titel ?? '').join(' & ');
  const context = polls.length === 0
    ? tx('Lege deine erste Umfrage an und teile den Link mit den Teilnehmenden.')
    : pending.length > 0
      ? tx`${titles} wartet auf einen finalen Termin.`
      : tx('Alle offenen Umfragen sind entschieden — gute Planung!');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{gruss(clock)}</h1>
          <p className="text-sm text-muted-foreground">{context}</p>
        </div>
        {crud.umfragen.canWrite && (
          <Button onClick={() => crud.umfragen.openCreate({ status: 'offen' })} className="w-full sm:w-auto">
            <IconPlus size={16} className="shrink-0" />{tx('Neue Umfrage')}
          </Button>
        )}
      </div>

      <DashboardGrid
        variant="split"
        kpis={
          <StatStrip>
            <StatStripItem
              title={tx('Offen')}
              value={openPolls.length}
              icon={<IconChartBar size={18} className="text-muted-foreground" />}
              onClick={() => setFilter(f => f === 'open' ? 'all' : 'open')}
              active={filter === 'open'}
            />
            <StatStripItem
              title={tx('Ohne finalen Termin')}
              value={pending.length}
              icon={<IconClockQuestion size={18} className="text-muted-foreground" />}
              tone={pending.length > 0 ? 'warning' : 'default'}
              onClick={() => setFilter(f => f === 'pending' ? 'all' : 'pending')}
              active={filter === 'pending'}
            />
          </StatStrip>
        }
        aside={
          <>
            <WorkList
              title={tx('Bereit zum Festlegen')}
              items={pending.filter(p => p.bestId).map(p => {
                const best = p.terms.find(s => s.t.record_id === p.bestId)!;
                return {
                  id: p.u.record_id,
                  title: p.u.fields.titel ?? '—',
                  secondLine: <span className="text-muted-foreground">{fmtTerm(best.t)} · {tx`${best.ja} Ja`}</span>,
                  action: { label: tx('Festlegen'), onClick: finalize(p.u, p.bestId!) },
                };
              })}
              onItemClick={id => { const u = umfragen.find(x => x.record_id === id); if (u) crud.umfragen.openDetail(u); }}
              empty={{ text: tx('Sobald Ja-Stimmen eintreffen, erscheint hier der beste Termin.') }}
            />
            <WorkList
              title={tx('Noch ohne Antworten')}
              items={noAnswers.map(p => ({
                id: p.u.record_id,
                title: p.u.fields.titel ?? '—',
                secondLine: <span className="text-muted-foreground">{tx('Link teilen, um Stimmen zu sammeln')}</span>,
              }))}
              onItemClick={id => { const u = umfragen.find(x => x.record_id === id); if (u) crud.umfragen.openDetail(u); }}
              empty={{ text: tx('Alle offenen Umfragen haben Antworten.') }}
            />
          </>
        }
        primary={
          <div className="space-y-4">
            {shown.length === 0 && (
              <div className="rounded-[27px] bg-card p-8 text-center shadow-lg">
                <IconCalendarEvent size={48} className="mx-auto mb-3 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">{tx('Keine Umfragen in dieser Ansicht.')}</p>
              </div>
            )}
            {shown.map(p => (
              <section key={p.u.record_id} className="overflow-hidden rounded-[27px] bg-card p-4 shadow-lg sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <button type="button" className="min-w-0 text-left" onClick={() => crud.umfragen.openDetail(umfragen.find(x => x.record_id === p.u.record_id) ?? p.u)}>
                    <h2 className="truncate text-lg font-semibold">{p.u.fields.titel ?? '—'}</h2>
                    <p className="truncate text-xs text-muted-foreground">
                      {p.u.fields.ort ? `${p.u.fields.ort} · ` : ''}{tx`${p.participants} Teilnehmende`}
                    </p>
                  </button>
                  <span className={`text-xs font-medium ${p.open ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                    {p.open ? tx('Offen') : tx('Geschlossen')}
                  </span>
                </div>
                <ul className="mt-3 divide-y">
                  {p.terms.length === 0 && <li className="py-2 text-sm text-muted-foreground">{tx('Noch keine Terminvorschläge')}</li>}
                  {p.terms.map(s => {
                    const isFinal = p.finalId === s.t.record_id;
                    return (
                      <li key={s.t.record_id} className={`flex flex-wrap items-center gap-2 py-2 ${s.best ? 'font-medium' : ''}`}>
                        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm" onClick={() => crud.terminvorschlaege.openDetail(s.t)}>
                          {isFinal ? <IconCheck size={16} className="shrink-0 text-emerald-600" /> : s.best ? <IconTrophy size={16} className="shrink-0 text-amber-500" /> : <span className="w-4 shrink-0" />}
                          <span className="truncate">{fmtTerm(s.t)}</span>
                        </button>
                        <span className="text-sm"><b>{s.ja}</b> {tx('Ja')} · {s.vielleicht} {tx('Vielleicht')}</span>
                        {p.open && !p.finalId && (
                          <Button variant="ghost" size="sm" onClick={finalize(p.u, s.t.record_id)}>{tx('Festlegen')}</Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-3"><ShareButtons recordId={p.u.record_id} /></div>
              </section>
            ))}
          </div>
        }
      />
      {crud.surfaces}
    </div>
  );
}
