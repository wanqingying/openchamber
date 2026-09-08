import React from 'react';
import { SettingsPageLayout } from '@/components/sections/shared/SettingsPageLayout';
import { SettingsSection } from '@/components/sections/shared/SettingsSection';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { mcApi } from '@/lib/mcApiInstance';
import type { McGateReason, McGated, McMemoriesPage } from '@/lib/mcApi';

type Phase =
  | { kind: 'loading' }
  | { kind: 'gated'; reason: McGateReason; schemaVersion?: number; maxSupportedSchema?: number; targetMcVersion?: string }
  | { kind: 'ready'; page: McMemoriesPage }
  | { kind: 'error' };

const gatedPhase = (gated: McGated): Extract<Phase, { kind: 'gated' }> => {
  const phase: Extract<Phase, { kind: 'gated' }> = { kind: 'gated', reason: gated.reason };
  if (gated.schemaVersion !== undefined) {
    phase.schemaVersion = gated.schemaVersion;
  }
  if (gated.maxSupportedSchema !== undefined) {
    phase.maxSupportedSchema = gated.maxSupportedSchema;
  }
  if (gated.targetMcVersion !== undefined) {
    phase.targetMcVersion = gated.targetMcVersion;
  }
  return phase;
};

export const MagicContextPage: React.FC = () => {
  const { t } = useI18n();
  const [phase, setPhase] = React.useState<Phase>({ kind: 'loading' });

  const load = React.useCallback(async () => {
    setPhase({ kind: 'loading' });
    try {
      const meta = await mcApi.fetchMeta();
      if (meta.gated) {
        setPhase(gatedPhase(meta));
        return;
      }
      const memories = await mcApi.fetchMemories({ limit: 100 });
      if ('gated' in memories) {
        setPhase(gatedPhase(memories));
        return;
      }
      setPhase({ kind: 'ready', page: memories });
    } catch {
      setPhase({ kind: 'error' });
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const renderGate = (phase: Extract<Phase, { kind: 'gated' }>) => {
    if (phase.reason === 'missing-db') {
      return <p className="typography-body text-muted-foreground">{t('settings.magicContext.gate.missingDb')}</p>;
    }
    if (phase.reason === 'schema-too-new') {
      return (
        <p className="typography-body text-muted-foreground">
          {t('settings.magicContext.gate.schemaTooNew', {
            schemaVersion: String(phase.schemaVersion ?? 0),
            maxSupportedSchema: String(phase.maxSupportedSchema ?? 0),
            targetMcVersion: phase.targetMcVersion ?? '',
          })}
        </p>
      );
    }
    return (
      <p className="typography-body text-muted-foreground">
        {t('settings.magicContext.gate.unavailable', { reason: phase.reason })}
      </p>
    );
  };

  const renderBody = () => {
    if (phase.kind === 'loading') {
      return <p className="typography-body text-muted-foreground">{t('settings.magicContext.loading')}</p>;
    }
    if (phase.kind === 'error') {
      return (
        <div className="flex flex-col items-start gap-3">
          <p className="typography-body text-muted-foreground">{t('settings.magicContext.loadError')}</p>
          <Button variant="secondary" size="sm" onClick={load}>{t('settings.magicContext.retry')}</Button>
        </div>
      );
    }
    if (phase.kind === 'gated') {
      return (
        <div className="flex flex-col items-start gap-3">
          {renderGate(phase)}
          <Button variant="secondary" size="sm" onClick={load}>{t('settings.magicContext.retry')}</Button>
        </div>
      );
    }
    if (phase.page.items.length === 0) {
      return <p className="typography-body text-muted-foreground">{t('settings.magicContext.empty')}</p>;
    }
    return (
      <ul className="space-y-4">
        {phase.page.items.map((item) => (
          <li key={item.id} className="space-y-1">
            <p className="typography-body text-foreground">{item.contentExcerpt ?? ''}</p>
            <p className="typography-caption text-muted-foreground">
              {item.category} · {item.projectPath} · {item.status}
            </p>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <SettingsPageLayout
      title={t('settings.page.magicContext.title')}
      description={t('settings.magicContext.description')}
    >
      <SettingsSection divider={false}>{renderBody()}</SettingsSection>
    </SettingsPageLayout>
  );
};
