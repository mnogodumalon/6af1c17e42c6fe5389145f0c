/**
 * Umfrage abschließen — 3-Schritt-Wizard.
 * Steps: 1) Offene Umfrage wählen → 2) Finalen Termin aus den Terminvorschlägen wählen → 3) Prüfen & Umfrage schließen.
 * Reads: umfragen, terminvorschlaege. Writes: umfragen (finaler_termin, status=geschlossen).
 * Composes: IntentWizardShell, EntitySelectStep, StepNav, SummaryStep, SuccessStep.
 */
import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { IntentWizardShell, WizardStep } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { fieldText, fieldDate } from '@/lib/journey';
import { useUmfrageAbschliessenFlow } from '@/lib/journey/flows/UmfrageAbschliessen';
import { tx } from '@/i18n';

function readDate(iso: string | null): string {
  if (!iso) return '';
  try {
    return format(parseISO(iso), 'dd.MM.yyyy HH:mm');
  } catch {
    return iso;
  }
}

export default function UmfrageAbschliessenPage() {
  const [step, setStep] = useState(1);
  const flow = useUmfrageAbschliessenFlow({
    steps: { umfragen: 1, finaler_termin: 2 },
    items: {
      umfragen: u => ({ id: u.id, title: fieldText(u, 'titel'), subtitle: fieldText(u, 'ort') }),
      finaler_termin: t => {
        const von = readDate(fieldDate(t, 'beginn'));
        const bis = readDate(fieldDate(t, 'ende'));
        return { id: t.id, title: von, subtitle: bis ? tx`bis ${bis}` : undefined };
      },
    },
  });

  const hasUmfrage = Boolean(flow.targets.umfragen.selectedId);

  return (
    <IntentWizardShell
      title={tx('Umfrage abschließen')}
      currentStep={step}
      onStepChange={setStep}
      forms={flow.formList}
      draftKey={flow.draftKey}
      intro={{
        description: tx('Finalen Termin festlegen und die Umfrage schließen.'),
        needs: [tx('Eine offene Umfrage mit Terminvorschlägen')],
      }}
    >
      <WizardStep label={tx('Umfrage')} description={tx('Welche offene Umfrage möchtest du abschließen?')}>
        <EntitySelectStep
          {...flow.picks.umfragen.select}
          {...flow.pick('umfragen')}
          searchPlaceholder={tx('Titel oder Ort …')}
          emptyText={tx('Es gibt keine offene Umfrage.')}
        />
      </WizardStep>
      <WizardStep label={tx('Termin')} description={tx('Welcher Terminvorschlag soll der finale Termin werden?')}>
        {hasUmfrage ? (
          <>
            <div className="mb-4 overflow-hidden rounded-2xl border bg-secondary p-4 text-sm">
              <span className="text-muted-foreground">{tx('Umfrage')}: </span>
              <span className="font-medium">
                {flow.picks.umfragen.labelOf(flow.targets.umfragen.selectedId ?? '') ?? ''}
              </span>
            </div>
            <EntitySelectStep
              {...flow.picks.finaler_termin.select}
              {...flow.pick('finaler_termin')}
              avatar="none"
              emptyText={tx('Diese Umfrage hat noch keine Terminvorschläge.')}
            />
          </>
        ) : (
          <StepNav onBack={() => setStep(1)} nextDisabled>
            {tx('Dieser Schritt braucht die Auswahl aus Schritt 1.')}
          </StepNav>
        )}
      </WizardStep>
      <WizardStep label={tx('Prüfen')}>
        {!flow.submit.done && (
          <SummaryStep
            forms={flow.formList}
            submit={flow.submit}
            confirmLabel={tx('Umfrage schließen')}
            whatHappensNext={tx('Danach ist keine Abstimmung mehr möglich.')}
          />
        )}
      </WizardStep>
      {flow.submit.result && (
        <SuccessStep
          result={flow.submit.result}
          forms={flow.formList}
          submit={flow.submit}
          undo={flow.undo}
          title={tx('Umfrage geschlossen')}
          next={[
            { label: tx('Weitere Umfrage abschließen'), onClick: () => { flow.reset(); setStep(1); } },
            { label: tx('Umfrage mit Terminen anlegen'), href: '#/intents/umfrage-anlegen' },
            { label: tx('Zum Dashboard'), href: '#/' },
          ]}
          whatHappensNext={tx('Teilnehmer können nicht mehr abstimmen.')}
        />
      )}
    </IntentWizardShell>
  );
}
