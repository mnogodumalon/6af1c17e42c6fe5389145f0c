import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { IconCheck, IconQuestionMark, IconX, IconTrophy, IconLock } from '@tabler/icons-react';
import { tx } from '@/i18n';
import { PublicShell } from '@/components/PublicShell';
import { Button } from '@/components/ui/button';
import { Bound } from '@/components/blocks/Bound';
import { FieldErrorSummary } from '@/components/blocks/FieldErrorSummary';
import { LoadProblem } from '@/components/blocks/LoadProblem';
import {
  loadPublicPagesConfig,
  type PublicPagesConfig,
  type PublicPageConfig,
} from '@/lib/publicClient';
import { createPublicPort } from '@/lib/journey/publicPort';
import {
  useLiveList,
  useStepForm,
  useJourneySubmit,
  fieldRef,
  fieldText,
  fieldDate,
  fieldLookup,
  type JourneyRecord,
  type PlanStep,
} from '@/lib/journey';

type Answer = 'ja' | 'vielleicht' | 'nein';

const SLUG = 'termin-abstimmen';
const ANSWERS: Answer[] = ['ja', 'vielleicht', 'nein'];

function nameKey(v: string, n: string): string {
  return `${v} ${n}`.trim().toLowerCase().replace(/\s+/g, ' ');
}

function parseLocal(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dayLabel(iso: string | null): string {
  const d = parseLocal(iso);
  return d ? d.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: '2-digit' }) : '—';
}

function timeLabel(from: string | null, to: string | null): string {
  const a = parseLocal(from);
  if (!a) return '';
  const fmt = (d: Date) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const b = parseLocal(to);
  return b ? `${fmt(a)}–${fmt(b)}` : fmt(a);
}

function AnswerIcon({ a }: { a: Answer | undefined }) {
  if (a === 'ja') return <IconCheck size={18} className="text-emerald-600" aria-label="Ja" />; /* i18n-exempt */
  if (a === 'vielleicht') return <IconQuestionMark size={18} className="text-amber-500" aria-label="Vielleicht" />; /* i18n-exempt */
  if (a === 'nein') return <IconX size={18} className="text-rose-500" aria-label="Nein" />; /* i18n-exempt */
  return <span className="text-muted-foreground">–</span>;
}

export default function TerminAbstimmen() {
  const [params] = useSearchParams();
  const linkedId = params.get('umfrage');

  const [cfg, setCfg] = useState<PublicPagesConfig | null>(null);
  const [page, setPage] = useState<PublicPageConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<Record<string, Answer>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    loadPublicPagesConfig(SLUG)
      .then(c => {
        setCfg(c);
        setPage(c?.pages[SLUG] ?? null);
      })
      .catch(() => {
        setCfg(null);
        setPage(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const port = useMemo(() => (cfg && page ? createPublicPort(cfg, page) : null), [cfg, page]);

  const umfragenLive = useLiveList(port, 'umfragen', { intervalMs: 0 });
  const termineLive = useLiveList(port, 'terminvorschlaege', { intervalMs: 0 });
  const antwortenLive = useLiveList(port, 'antworten', { intervalMs: 30_000 });

  const umfrage = useMemo<JourneyRecord | null>(
    () => umfragenLive.records.find(r => r.id === linkedId) ?? null,
    [umfragenLive.records, linkedId],
  );

  const termine = useMemo(
    () =>
      termineLive.records
        .filter(r => fieldRef(r, 'umfrage') === linkedId)
        .sort((a, b) => (fieldDate(a, 'beginn') ?? '').localeCompare(fieldDate(b, 'beginn') ?? '')),
    [termineLive.records, linkedId],
  );

  const antworten = useMemo(
    () => antwortenLive.records.filter(r => fieldRef(r, 'umfrage') === linkedId),
    [antwortenLive.records, linkedId],
  );

  const teilnehmer = useMemo(() => {
    const map = new Map<string, { name: string; created: string; answers: Record<string, Answer> }>();
    const sorted = [...antworten].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
    for (const r of sorted) {
      const v = fieldText(r, 'teilnehmer_vorname');
      const n = fieldText(r, 'teilnehmer_nachname');
      const k = nameKey(v, n);
      const entry = map.get(k) ?? { name: `${v} ${n}`.trim(), created: r.createdAt ?? '', answers: {} };
      const terminId = fieldRef(r, 'terminvorschlag');
      const a = fieldLookup(r, 'antwort')?.key as Answer | undefined;
      if (terminId && a) entry.answers[terminId] = a;
      map.set(k, entry);
    }
    return [...map.values()];
  }, [antworten]);

  const counts = useMemo(() => {
    const out: Record<string, { ja: number; vielleicht: number }> = {};
    for (const t of termine) out[t.id] = { ja: 0, vielleicht: 0 };
    for (const p of teilnehmer) {
      for (const [tid, a] of Object.entries(p.answers)) {
        if (!out[tid]) continue;
        if (a === 'ja') out[tid].ja += 1;
        if (a === 'vielleicht') out[tid].vielleicht += 1;
      }
    }
    return out;
  }, [termine, teilnehmer]);

  const maxJa = useMemo(() => Math.max(0, ...Object.values(counts).map(c => c.ja)), [counts]);

  const closed = fieldLookup(umfrage ?? ({ id: '', fields: {}, createdAt: null } as JourneyRecord), 'status')?.key === 'geschlossen';
  const finalId = umfrage ? fieldRef(umfrage, 'finaler_termin') : null;
  const finalTermin = finalId ? termine.find(t => t.id === finalId) ?? null : null;

  const nameForm = useStepForm('antworten', {
    fields: ['teilnehmer_vorname', 'teilnehmer_nachname'],
    autoComplete: true,
  });

  // The plan reads answers and names through refs so its identity only changes with the dates.
  const pickedRef = useRef(picked);
  pickedRef.current = picked;
  const nameRef = useRef(nameForm);
  nameRef.current = nameForm;

  const plan = useMemo<PlanStep[]>(() => {
    if (!port || !linkedId) return [];
    return termine.map((t, i) => ({
      key: `termin-${t.id}`,
      entity: 'antworten' as const,
      label: `${dayLabel(fieldDate(t, 'beginn'))} ${timeLabel(fieldDate(t, 'beginn'), fieldDate(t, 'ende'))}`.trim(),
      primary: i === 0,
      form: nameRef.current,
      values: () => ({
        umfrage: linkedId,
        terminvorschlag: t.id,
        teilnehmer_vorname: String(nameRef.current.get('teilnehmer_vorname') ?? '').trim(),
        teilnehmer_nachname: String(nameRef.current.get('teilnehmer_nachname') ?? '').trim(),
        antwort: pickedRef.current[t.id],
      }),
    }));
  }, [port, linkedId, termine]);

  const submit = useJourneySubmit(
    port ?? ({} as NonNullable<typeof port>),
    plan,
    {
      draftKey: `termin-abstimmen-${linkedId ?? 'x'}`,
      onSuccess: () => {
        void antwortenLive.reload();
      },
    },
  );

  const handleSave = async () => {
    if (!port || !linkedId) return;
    setFormError(null);
    const namesOk = nameForm.validate();
    const missing = termine.some(t => !picked[t.id]);
    if (!namesOk) return;
    if (missing) {
      setFormError(tx('Bitte wähle bei jedem Termin Ja, Vielleicht oder Nein.'));
      return;
    }
    setChecking(true);
    try {
      const [freshUmfrage, freshAntworten] = await Promise.all([port.get('umfragen', linkedId), port.list('antworten')]);
      if (freshUmfrage && fieldLookup(freshUmfrage, 'status')?.key === 'geschlossen') {
        setFormError(tx('Die Umfrage wurde inzwischen geschlossen.'));
        void umfragenLive.reload();
        return;
      }
      const mine = nameKey(
        String(nameForm.get('teilnehmer_vorname') ?? ''),
        String(nameForm.get('teilnehmer_nachname') ?? ''),
      );
      const dup = freshAntworten.some(
        r =>
          fieldRef(r, 'umfrage') === linkedId &&
          nameKey(fieldText(r, 'teilnehmer_vorname'), fieldText(r, 'teilnehmer_nachname')) === mine,
      );
      if (dup && !submit.error) {
        setFormError(tx('Dieser Name hat bereits abgestimmt.'));
        void antwortenLive.reload();
        return;
      }
    } catch {
      setFormError(tx('Das hat gerade nicht geklappt. Bitte versuche es noch einmal.'));
      return;
    } finally {
      setChecking(false);
    }
    await submit.run();
  };

  const restart = () => {
    submit.reset();
    nameForm.reset();
    setPicked({});
    setFormError(null);
  };

  if (loading || !cfg || !page) {
    return <PublicShell loading={loading} unavailable={!loading} />;
  }

  if (!linkedId) {
    return (
      <PublicShell title={page.title} wide>
        <p className="text-sm text-muted-foreground">
          {tx('Diese Seite braucht den persönlichen Link deiner Umfrage. Öffne ihn bitte noch einmal oder scanne den QR-Code.')}
        </p>
      </PublicShell>
    );
  }

  if (!umfragenLive.loaded && umfragenLive.error) {
    return (
      <PublicShell title={page.title} wide>
        <LoadProblem onRetry={umfragenLive.reload} />
      </PublicShell>
    );
  }

  if (!umfragenLive.loaded || !termineLive.loaded || !antwortenLive.loaded) {
    if (termineLive.error || antwortenLive.error) {
      return (
        <PublicShell title={page.title} wide>
          <LoadProblem
            onRetry={async () => {
              await Promise.all([termineLive.reload(), antwortenLive.reload()]);
            }}
          />
        </PublicShell>
      );
    }
    return <PublicShell loading wide />;
  }

  if (!umfrage) {
    return (
      <PublicShell title={page.title} wide>
        <p className="text-sm text-muted-foreground">
          {tx('Dieser Link passt zu keiner Umfrage. Scanne bitte den QR-Code noch einmal.')}
        </p>
      </PublicShell>
    );
  }

  const ownRowVisible = !closed && !submit.result && termine.length > 0;

  return (
    <PublicShell title={fieldText(umfrage, 'titel')} description={fieldText(umfrage, 'beschreibung') || undefined} wide>
      <div className="space-y-5">
        {fieldText(umfrage, 'ort') && (
          <p className="text-sm text-muted-foreground">{tx('Ort')}: {fieldText(umfrage, 'ort')}</p>
        )}

        {closed && (
          <div className="rounded-xl border bg-muted/40 p-4 flex items-start gap-3">
            <IconLock size={20} className="shrink-0 mt-0.5 text-muted-foreground" />
            <div className="min-w-0">
              <p className="font-medium">{tx('Die Umfrage ist geschlossen.')}</p>
              {finalTermin ? (
                <p className="text-sm mt-1">
                  {tx('Finaler Termin')}: <b>{dayLabel(fieldDate(finalTermin, 'beginn'))}</b>{' '}
                  {timeLabel(fieldDate(finalTermin, 'beginn'), fieldDate(finalTermin, 'ende'))}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground mt-1">{tx('Es wurde noch kein finaler Termin festgelegt.')}</p>
              )}
            </div>
          </div>
        )}

        {termine.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tx('Für diese Umfrage gibt es noch keine Termine.')}</p>
        ) : (
          <>
            {ownRowVisible && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Bound form={nameForm} name="teilnehmer_vorname" />
                <Bound form={nameForm} name="teilnehmer_nachname" />
              </div>
            )}

            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-card text-left p-2 font-medium max-w-[40vw] min-w-[6rem]" />
                    {termine.map(t => {
                      const isTop = closed ? t.id === finalId : maxJa > 0 && counts[t.id]?.ja === maxJa;
                      return (
                        <th
                          key={t.id}
                          className={`p-2 text-center font-medium align-top min-w-[7rem] ${isTop ? 'bg-emerald-50 text-emerald-900' : ''}`}
                        >
                          <div className="whitespace-nowrap">{dayLabel(fieldDate(t, 'beginn'))}</div>
                          <div className="text-xs font-normal text-muted-foreground whitespace-nowrap">
                            {timeLabel(fieldDate(t, 'beginn'), fieldDate(t, 'ende'))}
                          </div>
                          {isTop && (
                            <div className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-700">
                              <IconTrophy size={14} />
                              {closed ? tx('Final') : tx('Meiste Ja')}
                            </div>
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {teilnehmer.map(p => (
                    <tr key={nameKey(p.name, '')} className="border-t">
                      <td className="sticky left-0 z-10 bg-card p-2 max-w-[40vw] truncate">{p.name}</td>
                      {termine.map(t => (
                        <td key={t.id} className="p-2 text-center">
                          <span className="inline-flex justify-center">
                            <AnswerIcon a={p.answers[t.id]} />
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                  {teilnehmer.length === 0 && (
                    <tr className="border-t">
                      <td colSpan={termine.length + 1} className="p-3 text-center text-muted-foreground">
                        {tx('Noch niemand hat abgestimmt.')}
                      </td>
                    </tr>
                  )}
                  {ownRowVisible && (
                    <tr className="border-t bg-muted/30">
                      <td className="sticky left-0 z-10 bg-muted p-2 max-w-[40vw] font-medium">{tx('Dein Eintrag')}</td>
                      {termine.map(t => (
                        <td key={t.id} className="p-2 text-center">
                          <div role="radiogroup" className="inline-flex gap-1">
                            {ANSWERS.map(a => {
                              const on = picked[t.id] === a;
                              const label = a === 'ja' ? tx('Ja') : a === 'vielleicht' ? tx('Vielleicht') : tx('Nein');
                              const tone =
                                a === 'ja'
                                  ? 'bg-emerald-600 text-white border-emerald-600'
                                  : a === 'vielleicht'
                                    ? 'bg-amber-500 text-white border-amber-500'
                                    : 'bg-rose-500 text-white border-rose-500';
                              return (
                                <button
                                  key={a}
                                  type="button"
                                  role="radio"
                                  aria-checked={on}
                                  aria-label={label}
                                  title={label}
                                  onClick={() => setPicked(prev => ({ ...prev, [t.id]: a }))}
                                  className={`h-9 w-9 rounded-md border flex items-center justify-center ${on ? tone : 'bg-card text-muted-foreground hover:bg-muted'}`}
                                >
                                  {a === 'ja' ? <IconCheck size={16} /> : a === 'vielleicht' ? <IconQuestionMark size={16} /> : <IconX size={16} />}
                                </button>
                              );
                            })}
                          </div>
                        </td>
                      ))}
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t">
                    <td className="sticky left-0 z-10 bg-card p-2 text-xs text-muted-foreground max-w-[40vw]">{tx('Anzahl')}</td>
                    {termine.map(t => {
                      const isTop = closed ? t.id === finalId : maxJa > 0 && counts[t.id]?.ja === maxJa;
                      return (
                        <td key={t.id} className={`p-2 text-center text-xs ${isTop ? 'bg-emerald-50' : ''}`}>
                          <div className="font-medium text-emerald-700">{tx`${counts[t.id]?.ja ?? 0} Ja`}</div>
                          <div className="text-amber-600">{tx`${counts[t.id]?.vielleicht ?? 0} Vielleicht`}</div>
                        </td>
                      );
                    })}
                  </tr>
                </tfoot>
              </table>
            </div>

            {ownRowVisible && (
              <div className="space-y-3">
                <FieldErrorSummary forms={[nameForm]} />
                {formError && <p className="text-sm text-destructive">{formError}</p>}
                {submit.error && !submit.offline && (
                  <p className="text-sm text-destructive">{tx('Das Speichern hat nicht geklappt. Tippe noch einmal auf Speichern – nichts wird doppelt eingetragen.')}</p>
                )}
                {submit.offline && (
                  <p className="text-sm text-muted-foreground">{tx('Keine Verbindung — deine Eingaben sind gesichert.')}</p>
                )}
                <Button
                  type="button"
                  className="w-full sm:w-auto"
                  disabled={submit.submitting || checking}
                  onClick={() => void handleSave()}
                >
                  {submit.submitting || checking ? tx('Wird gespeichert …') : tx('Antworten speichern')}
                </Button>
              </div>
            )}

            {submit.result && !closed && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
                <p className="text-sm text-emerald-900">{tx('Danke! Deine Antworten sind gespeichert und stehen in der Tabelle.')}</p>
                <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={restart}>
                  {tx('Weitere Person eintragen')}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </PublicShell>
  );
}
