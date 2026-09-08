import React from 'react';
import { SettingsPageLayout } from '@/components/sections/shared/SettingsPageLayout';
import { SettingsSection } from '@/components/sections/shared/SettingsSection';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { mcApi } from '@/lib/mcApiInstance';
import type { McGateReason, McGated, McMemoryItem, McOverview } from '@/lib/mcApi';

type View =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'gated'; reason: McGateReason; schemaVersion?: number; maxSupportedSchema?: number; targetMcVersion?: string }
  | { status: 'ready' };

const PAGE_SIZE = 100;

const gatedView = (gated: McGated): Extract<View, { status: 'gated' }> => {
  const view: Extract<View, { status: 'gated' }> = { status: 'gated', reason: gated.reason };
  if (gated.schemaVersion !== undefined) {
    view.schemaVersion = gated.schemaVersion;
  }
  if (gated.maxSupportedSchema !== undefined) {
    view.maxSupportedSchema = gated.maxSupportedSchema;
  }
  if (gated.targetMcVersion !== undefined) {
    view.targetMcVersion = gated.targetMcVersion;
  }
  return view;
};

export const MagicContextPage: React.FC = () => {
  const { t } = useI18n();
  const [view, setView] = React.useState<View>({ status: 'loading' });
  const [overview, setOverview] = React.useState<McOverview | null>(null);
  const [items, setItems] = React.useState<McMemoryItem[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loadMoreError, setLoadMoreError] = React.useState(false);

  const loadFirstPage = React.useCallback(async () => {
    setView({ status: 'loading' });
    setLoadMoreError(false);
    setOverview(null);
    try {
      const meta = await mcApi.fetchMeta();
      if (meta.gated) {
        setView(gatedView(meta));
        return;
      }
      const [memories, overviewData] = await Promise.all([
        mcApi.fetchMemories({ limit: PAGE_SIZE }),
        mcApi.fetchOverview(),
      ]);
      const gate = 'gated' in memories ? memories : 'totalMemories' in overviewData ? null : overviewData;
      if (gate) {
        setView(gatedView(gate));
        return;
      }
      if ('totalMemories' in overviewData) {
        setOverview(overviewData);
      }
      if (!('gated' in memories)) {
        setItems(memories.items);
        setTotal(memories.total);
      }
      setView({ status: 'ready' });
    } catch {
      setView({ status: 'error' });
    }
  }, []);

  React.useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  const loadMore = React.useCallback(async () => {
    setLoadMoreError(false);
    try {
      const memories = await mcApi.fetchMemories({ limit: PAGE_SIZE, offset: items.length });
      if ('gated' in memories || memories.items.length === 0) {
        return;
      }
      setItems((previous) => [...previous, ...memories.items]);
      setTotal(memories.total);
    } catch {
      setLoadMoreError(true);
    }
  }, [items.length]);

  const renderGate = (view: Extract<View, { status: 'gated' }>) => {
    if (view.reason === 'missing-db') {
      return <p className="typography-body text-muted-foreground">{t('settings.magicContext.gate.missingDb')}</p>;
    }
    if (view.reason === 'schema-too-new') {
      return (
        <p className="typography-body text-muted-foreground">
          {t('settings.magicContext.gate.schemaTooNew', {
            schemaVersion: String(view.schemaVersion ?? 0),
            maxSupportedSchema: String(view.maxSupportedSchema ?? 0),
            targetMcVersion: view.targetMcVersion ?? '',
          })}
        </p>
      );
    }
    return (
      <p className="typography-body text-muted-foreground">
        {t('settings.magicContext.gate.unavailable', { reason: view.reason })}
      </p>
    );
  };

  const renderBody = () => {
    if (view.status === 'loading') {
      return <p className="typography-body text-muted-foreground">{t('settings.magicContext.loading')}</p>;
    }
    if (view.status === 'error') {
      return (
        <div className="flex flex-col items-start gap-3">
          <p className="typography-body text-muted-foreground">{t('settings.magicContext.loadError')}</p>
          <Button variant="secondary" size="sm" onClick={loadFirstPage}>{t('settings.magicContext.retry')}</Button>
        </div>
      );
    }
    if (view.status === 'gated') {
      return (
        <div className="flex flex-col items-start gap-3">
          {renderGate(view)}
          <Button variant="secondary" size="sm" onClick={loadFirstPage}>{t('settings.magicContext.retry')}</Button>
        </div>
      );
    }
    const overviewBlock = overview ? (
      <div className="space-y-2">
        <p className="typography-body font-medium text-foreground">{t('settings.magicContext.overview.title')}</p>
        <div className="flex flex-wrap gap-x-8 gap-y-2">
          {(
            [
              [overview.totalMemories, t('settings.magicContext.stat.totalMemories')],
              [overview.currentMemories, t('settings.magicContext.stat.currentMemories')],
              [overview.projects, t('settings.magicContext.stat.projects')],
              [overview.categories, t('settings.magicContext.stat.categories')],
            ] as const
          ).map(([value, label]) => (
            <div key={label} className="flex items-baseline gap-1.5">
              <span className="text-lg font-semibold tabular-nums text-foreground">{value}</span>
              <span className="typography-caption text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      </div>
    ) : null;
    if (items.length === 0) {
      return (
        <div className="space-y-4">
          {overviewBlock}
          <p className="typography-body text-muted-foreground">{t('settings.magicContext.empty')}</p>
        </div>
      );
    }
    const hasMore = items.length < total;
    return (
      <div className="space-y-4">
        {overviewBlock}
        <div className="space-y-3">
          <p className="typography-caption text-muted-foreground">
            {t('settings.magicContext.shownOfTotal', {
              shown: String(items.length),
              total: String(total),
            })}
          </p>
          <ul className="space-y-4">
            {items.map((item) => (
              <li key={item.id} className="space-y-1">
                <p className="typography-body text-foreground">{item.contentExcerpt ?? ''}</p>
                <p className="typography-caption text-muted-foreground">
                  {item.category} · {item.projectPath} · {item.status}
                </p>
              </li>
            ))}
          </ul>
          {hasMore ? (
            <div className="flex flex-col items-start gap-2">
              {loadMoreError ? (
                <p className="typography-body text-muted-foreground">{t('settings.magicContext.loadError')}</p>
              ) : null}
              <Button variant="secondary" size="sm" onClick={loadMore}>{t('settings.magicContext.loadMore')}</Button>
            </div>
          ) : null}
        </div>
      </div>
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
