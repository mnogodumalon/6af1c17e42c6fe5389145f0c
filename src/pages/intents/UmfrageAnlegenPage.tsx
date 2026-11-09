/**
 * Umfrage anlegen — 3-Schritt-Wizard.
 * Steps: 1) Titel, Beschreibung, Ort → 2) Terminvorschläge erfassen → 3) Prüfen & anlegen.
 * Reads: —. Writes: umfragen (status offen), terminvorschlaege (eine pro Eintrag).
 * Composes: IntentWizardShell, Bound, ListEntries, StepNav, SummaryStep, SuccessStep.
 */
import { useState } from 'react';
import { IntentWizardShell, WizardStep } from '@/components/blocks/IntentWizardShell';
import { Bound } from '@/components/blocks/Bound';
import { ListEntries } from '@/components/blocks/ListEntries';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { useUmfrageAnlegenFlow } from '@/lib/journey/flows/UmfrageAnlegen';
import { optionsOf } from '@/lib/journey';
import { tx } from '@/i18n';

export default function UmfrageAnlegenPage() {
  const [step, setStep] = useState(1);
  const flow = useUmfrageAnlegenFlow({
    steps: { titel: 1, beschreibung: 1, ort: 1, beginn: 2, ende: 2 },
  });

  const openLabel = optionsOf('umfragen', 'status').find(o => o.key === 'offen')?.label ?? '';

  return (
    <IntentWizardShell
      title={tx('Umfrage anlegen')}
      currentStep={step}
      onStepChange={setStep}
      forms={flow.formList}
      draftKey={flow.draftKey}
      intro={{
        description: tx('Lege eine Terminumfrage mit mehreren Terminvorschlägen an.'),
        needs: [tx('Titel der Umfrage'), tx('Mögliche Termine mit Beginn und Ende')],
      }}
    >
      <WizardStep label={tx('Umfrage')} description={tx('Worum geht es und wo findet es statt?')}>
        <div className="space-y-4">
          <Bound form={flow.forms.umfragen} name="titel" />
          <Bound form={flow.forms.umfragen} name="beschreibung" />
          <Bound form={flow.forms.umfragen} name="ort" />
          <StepNav hideBack onNext={() => flow.validateStep(1)} nextStepLabel={tx('Terminvorschläge')} />
        </div>
      </WizardStep>
      <WizardStep label={tx('Termine')} description={tx('Trage alle möglichen Termine ein — mindestens einen.')}>
        <div className="space-y-4">
          <ListEntries list={flow.lists.terminvorschlaege}>
            <Bound form={flow.forms.terminvorschlaege} name="beginn" />
            <Bound form={flow.forms.terminvorschlaege} name="ende" />
          </ListEntries>
          <StepNav onBack={() => setStep(1)} onNext={() => flow.validateStep(2)} nextStepLabel={tx('Prüfen')} />
        </div>
      </WizardStep>
      <WizardStep label={tx('Prüfen')}>
        {!flow.submit.done && (
          <SummaryStep
            forms={flow.formList}
            submit={flow.submit}
            items={[{ key: 'status', label: tx('Status'), value: openLabel }]}
            whatHappensNext={tx('Die Umfrage ist danach offen und der Link steht bereit.')}
          />
        )}
      </WizardStep>
      {flow.submit.result && (
        <SuccessStep
          result={flow.submit.result}
          forms={flow.formList}
          submit={flow.submit}
          whatHappensNext={tx('Die Umfrage ist offen. Sobald genug Antworten da sind, kannst du den finalen Termin festlegen.')}
          next={[
            { label: tx('Finalen Termin festlegen'), href: '#/intents/umfrage-abschliessen' },
            { label: tx('Zum Dashboard'), href: '#/' },
          ]}
        />
      )}
    </IntentWizardShell>
  );
}
