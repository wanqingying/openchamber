import React from 'react';
import { SettingsPageLayout } from '@/components/sections/shared/SettingsPageLayout';
import { SettingsSection } from '@/components/sections/shared/SettingsSection';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { mcApi } from '@/lib/mcApiInstance';
import type {
  McGateReason,
  McGated,
  McMemoryItem,
  McOverview,
  McPage,
  McPrimer,
  McDreamRun,
  McSession,
  McUserMemory,
  McWorkspace,
  McProjectStat,
  McCacheSession,
  McCacheTimeline,
  McCacheSeverity,
  McPrimerCandidate,
  McUserMemoryCandidate,
  McMural,
} from '@/lib/mcApi';

type View =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'gated'; reason: McGateReason; schemaVersion?: number; maxSupportedSchema?: number; targetMcVersion?: string }
  | { status: 'ready' };

interface Panels {
  projects: McPage<McProjectStat> | null;
  sessions: McPage<McSession> | null;
  cache: McPage<McCacheSession> | null;
  dreams: McPage<McDreamRun> | null;
  primers: McPage<McPrimer> | null;
  primerCandidates: McPage<McPrimerCandidate> | null;
  userMemories: McPage<McUserMemory> | null;
  userMemoryCandidates: McPage<McUserMemoryCandidate> | null;
  workspaces: McPage<McWorkspace> | null;
  murals: McPage<McMural> | null;
  config: string | null;
  logs: string | null;
}

const PAGE_SIZE = 100;
const PANEL_LIMIT = 6;

const SEVERITY_ORDER: ReadonlyArray<McCacheSeverity> = ['stable', 'warning', 'bust', 'full-bust', 'info', 'unknown'];

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

const formatEpoch = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
    return '';
  }
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return '';
  }
};

const formatBytes = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
    return '';
  }
  if (value >= 1048576) {
    return `${(value / 1048576).toFixed(1)} MB`;
  }
  return `${Math.round(value / 1024)} KB`;
};

export const MagicContextPage: React.FC = () => {
  const { t } = useI18n();

  const severityLabel = (severity: McCacheSeverity): string => {
    switch (severity) {
      case 'stable':
        return t('settings.magicContext.severity.stable');
      case 'warning':
        return t('settings.magicContext.severity.warning');
      case 'bust':
        return t('settings.magicContext.severity.bust');
      case 'full-bust':
        return t('settings.magicContext.severity.fullBust');
      case 'info':
        return t('settings.magicContext.severity.info');
      case 'unknown':
        return t('settings.magicContext.severity.unknown');
    }
  };

  const [view, setView] = React.useState<View>({ status: 'loading' });
  const [overview, setOverview] = React.useState<McOverview | null>(null);
  const [items, setItems] = React.useState<McMemoryItem[]>([]);
  const [total, setTotal] = React.useState(0);
  const [panels, setPanels] = React.useState<Panels>({ projects: null, sessions: null, cache: null, dreams: null, primers: null, primerCandidates: null, userMemories: null, userMemoryCandidates: null, workspaces: null, murals: null, config: null, logs: null });
  const [loadMoreError, setLoadMoreError] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [timeline, setTimeline] = React.useState<McCacheTimeline | null>(null);

  const loadPanels = React.useCallback(async () => {
    const [sessions, cache, dreams, primers, primerCandidates, userMemories, userMemoryCandidates, workspaces, murals, projects, config, logs] = await Promise.allSettled([
      mcApi.fetchSessions({ limit: PANEL_LIMIT }),
      mcApi.fetchCacheSessions({ limit: PANEL_LIMIT }),
      mcApi.fetchDreamRuns({ limit: PANEL_LIMIT }),
      mcApi.fetchPrimers({ limit: PANEL_LIMIT }),
      mcApi.fetchPrimerCandidates({ limit: PANEL_LIMIT }),
      mcApi.fetchUserMemories({ limit: PANEL_LIMIT, status: 'active' }),
      mcApi.fetchUserMemoryCandidates({ limit: PANEL_LIMIT }),
      mcApi.fetchWorkspaces({ limit: PANEL_LIMIT }),
      mcApi.fetchMuralManifests({ limit: PANEL_LIMIT }),
      mcApi.fetchProjects({ limit: 30 }),
      mcApi.fetchConfig(),
      mcApi.fetchLogs(),
    ]);
    const sessionsOk = sessions.status === 'fulfilled' && !('gated' in sessions.value) ? sessions.value : null;
    const cacheOk = cache.status === 'fulfilled' && !('gated' in cache.value) ? cache.value : null;
    const dreamsOk = dreams.status === 'fulfilled' && !('gated' in dreams.value) ? dreams.value : null;
    const primersOk = primers.status === 'fulfilled' && !('gated' in primers.value) ? primers.value : null;
    const primerCandidatesOk = primerCandidates.status === 'fulfilled' && !('gated' in primerCandidates.value) ? primerCandidates.value : null;
    const userMemoriesOk = userMemories.status === 'fulfilled' && !('gated' in userMemories.value) ? userMemories.value : null;
    const userMemoryCandidatesOk = userMemoryCandidates.status === 'fulfilled' && !('gated' in userMemoryCandidates.value) ? userMemoryCandidates.value : null;
    const workspacesOk = workspaces.status === 'fulfilled' && !('gated' in workspaces.value) ? workspaces.value : null;
    const muralsOk = murals.status === 'fulfilled' && !('gated' in murals.value) ? murals.value : null;
    const projectsOk = projects.status === 'fulfilled' && !('gated' in projects.value) ? projects.value : null;
    let nextTimeline: McCacheTimeline | null = null;
    const firstSession = sessionsOk && sessionsOk.items.length > 0 ? sessionsOk.items[0] : null;
    if (firstSession) {
      try {
        const timelineResult = await mcApi.fetchCacheTimeline(firstSession.id);
        if (!('gated' in timelineResult)) {
          nextTimeline = timelineResult;
        }
      } catch {
        nextTimeline = null;
      }
    }
    setTimeline(nextTimeline);
    setPanels({
      projects: projectsOk,
      sessions: sessionsOk,
      cache: cacheOk,
      dreams: dreamsOk,
      primers: primersOk,
      primerCandidates: primerCandidatesOk,
      userMemories: userMemoriesOk,
      userMemoryCandidates: userMemoryCandidatesOk,
      workspaces: workspacesOk,
      murals: muralsOk,
      config: config.status === 'fulfilled' && config.value.exists ? config.value.content : null,
      logs: logs.status === 'fulfilled' && logs.value.exists ? logs.value.content : null,
    });
  }, []);

  const loadFirstPage = React.useCallback(async () => {
    setView({ status: 'loading' });
    setLoadMoreError(false);
    setOverview(null);
    setPanels({ projects: null, sessions: null, cache: null, dreams: null, primers: null, primerCandidates: null, userMemories: null, userMemoryCandidates: null, workspaces: null, murals: null, config: null, logs: null });
    setTimeline(null);
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
      void loadPanels();
    } catch {
      setView({ status: 'error' });
    }
  }, [loadPanels]);

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

  React.useEffect(() => {
    if (view.status !== 'ready') {
      return;
    }
    const query = search.trim();
    const timer = setTimeout(async () => {
      try {
        const memories = query.length > 0
          ? await mcApi.fetchMemories({ limit: PAGE_SIZE, search: query })
          : await mcApi.fetchMemories({ limit: PAGE_SIZE });
        if ('gated' in memories) {
          return;
        }
        setItems(memories.items);
        setTotal(memories.total);
        setLoadMoreError(false);
      } catch {
        setLoadMoreError(true);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [search, view.status]);

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

  const listPanel = (empty: boolean) => (
    <div className="space-y-3">
      {empty ? (
        <p className="typography-body text-muted-foreground">{t('settings.magicContext.listEmpty')}</p>
      ) : null}
    </div>
  );

  const overviewBlock = overview ? (
    <SettingsSection title={t('settings.magicContext.overview.title')}>
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
    </SettingsSection>
  ) : null;

  const renderPanels = () => (
    <>
      {panels.sessions ? (
        <SettingsSection title={t('settings.magicContext.section.sessions')}>
          {panels.sessions.items.length === 0 ? listPanel(true) : (
            <ul className="space-y-3">
              {panels.sessions.items.map((session) => (
                <li key={session.id} className="space-y-0.5">
                  <p className="typography-body text-foreground">{session.title || session.id}</p>
                  <p className="typography-caption text-muted-foreground">
                    {[session.projectName, session.directory, formatEpoch(session.lastActivity)].filter(Boolean).join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SettingsSection>
      ) : null}
      {panels.cache ? (
        <SettingsSection title={t('settings.magicContext.section.cache')}>
          {panels.cache.items.length === 0 ? listPanel(true) : (
            <ul className="space-y-3">
              {panels.cache.items.map((entry) => (
                <li key={entry.sessionId} className="space-y-0.5">
                  <p className="typography-body text-foreground">{entry.sessionId}</p>
                  <p className="typography-caption text-muted-foreground">
                    {[entry.harness ?? '', formatBytes(entry.cachedM0Bytes), `m0:${entry.memoryBlockCount ?? 0}`, `compartments:${entry.compartmentCount}`].filter(Boolean).join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SettingsSection>
      ) : null}
      {timeline ? (
        <SettingsSection title={t('settings.magicContext.section.cacheTimeline')}>
          {(timeline.summary.warning ?? 0) + (timeline.summary.bust ?? 0) + (timeline.summary['full-bust'] ?? 0) + (timeline.summary.unknown ?? 0) > 0 ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-x-5 gap-y-1">
                {SEVERITY_ORDER.map((severity) => (
                  <div key={severity} className="flex items-baseline gap-1">
                    <span className="text-base font-semibold tabular-nums text-foreground">{timeline.summary[severity] ?? 0}</span>
                    <span className="typography-caption text-muted-foreground">{severityLabel(severity)}</span>
                  </div>
                ))}
              </div>
              <ul className="space-y-2">
                {timeline.events.slice(-6).map((event) => (
                  <li key={event.messageId} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <span className="typography-caption text-muted-foreground">{formatEpoch(event.time)}</span>
                    <span className="typography-body text-foreground">{severityLabel(event.severity)}</span>
                    <span className="typography-caption text-muted-foreground">
                      read:{event.cacheRead} · write:{event.cacheWrite} · total:{event.totalTokens}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="typography-body text-muted-foreground">{t('settings.magicContext.cacheNoActionable')}</p>
          )}
        </SettingsSection>
      ) : null}
      {panels.primerCandidates ? (
        <SettingsSection title={t('settings.magicContext.section.primerCandidates')}>
          {panels.primerCandidates.items.length === 0 ? listPanel(true) : (
            <ul className="space-y-3">
              {panels.primerCandidates.items.map((candidate) => (
                <li key={candidate.id} className="space-y-0.5">
                  <p className="typography-body text-foreground">{candidate.question}</p>
                  <p className="typography-caption text-muted-foreground">
                    {[candidate.projectPath, formatEpoch(candidate.sourceMessageTime)].filter(Boolean).join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SettingsSection>
      ) : null}
      {panels.userMemoryCandidates ? (
        <SettingsSection title={t('settings.magicContext.section.userMemoryCandidates')}>
          {panels.userMemoryCandidates.items.length === 0 ? listPanel(true) : (
            <ul className="space-y-3">
              {panels.userMemoryCandidates.items.map((candidate) => (
                <li key={candidate.id} className="space-y-0.5">
                  <p className="typography-body text-foreground">{candidate.content}</p>
                </li>
              ))}
            </ul>
          )}
        </SettingsSection>
      ) : null}
      {panels.murals ? (
        <SettingsSection title={t('settings.magicContext.section.mural')}>
          {panels.murals.items.length === 0 ? listPanel(true) : (
            <ul className="space-y-3">
              {panels.murals.items.map((mural) => (
                <li key={mural.projectPath} className="space-y-0.5">
                  <p className="typography-body text-foreground">{mural.projectPath}</p>
                  <p className="typography-caption text-muted-foreground">
                    {[formatEpoch(mural.renderedAt), mural.width !== null && mural.height !== null ? `${mural.width}×${mural.height}` : '', mural.model ?? ''].filter(Boolean).join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
          )}
         </SettingsSection>
      ) : null}
      {panels.dreams ? (
        <SettingsSection title={t('settings.magicContext.section.dreamer')}>
          {panels.dreams.items.length === 0 ? listPanel(true) : (
            <ul className="space-y-3">
              {panels.dreams.items.map((run) => (
                <li key={run.id} className="space-y-0.5">
                  <p className="typography-body text-foreground">{run.projectPath}</p>
                  <p className="typography-caption text-muted-foreground">
                    {[formatEpoch(run.finishedAt), `+${run.tasksSucceeded ?? 0}/-${run.tasksFailed ?? 0}`, formatEpoch(run.startedAt)].filter(Boolean).join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SettingsSection>
      ) : null}
      {panels.primers ? (
        <SettingsSection title={t('settings.magicContext.section.primers')}>
          {panels.primers.items.length === 0 ? listPanel(true) : (
            <ul className="space-y-3">
              {panels.primers.items.map((primer) => (
                <li key={primer.id} className="space-y-0.5">
                  <p className="typography-body text-foreground">{primer.question}</p>
                  <p className="typography-caption text-muted-foreground">
                    {[primer.status, primer.projectPath, formatEpoch(primer.lastObservedAt)].filter(Boolean).join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SettingsSection>
      ) : null}
      {panels.userMemories ? (
        <SettingsSection title={t('settings.magicContext.section.userMemories')}>
          {panels.userMemories.items.length === 0 ? listPanel(true) : (
            <ul className="space-y-3">
              {panels.userMemories.items.map((memory) => (
                <li key={memory.id} className="space-y-0.5">
                  <p className="typography-body text-foreground">{memory.content}</p>
                </li>
              ))}
            </ul>
          )}
        </SettingsSection>
      ) : null}
      {panels.workspaces ? (
        <SettingsSection title={t('settings.magicContext.section.workspaces')}>
          {panels.workspaces.items.length === 0 ? listPanel(true) : (
            <ul className="space-y-3">
              {panels.workspaces.items.map((workspace) => (
                <li key={workspace.id} className="space-y-0.5">
                  <p className="typography-body text-foreground">{workspace.name}</p>
                  <p className="typography-caption text-muted-foreground">
                    {[`${workspace.memberCount}`, workspace.shareCategories, formatEpoch(workspace.updatedAt)].filter(Boolean).join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SettingsSection>
      ) : null}
      {panels.config !== null ? (
        <SettingsSection title={t('settings.magicContext.section.config')}>
          {panels.config.length === 0 ? listPanel(true) : (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded border border-border bg-surface/40 p-3 font-mono text-xs text-foreground">{panels.config}</pre>
          )}
        </SettingsSection>
      ) : null}
      {panels.logs !== null ? (
        <SettingsSection title={t('settings.magicContext.section.logs')}>
          {panels.logs.length === 0 ? listPanel(true) : (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded border border-border bg-surface/40 p-3 font-mono text-xs text-foreground">{panels.logs}</pre>
          )}
        </SettingsSection>
      ) : null}
    </>
  );

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
    return (
      <>
        {overviewBlock}
      {panels.projects ? (
        <SettingsSection title={t('settings.magicContext.section.projects')}>
          {panels.projects.items.length === 0 ? listPanel(true) : (
            <ul className="space-y-4">
              {panels.projects.items.map((project) => (
                <li key={project.projectPath} className="space-y-1">
                  <p className="typography-body text-foreground">{project.projectPath}</p>
                  <p className="typography-caption text-muted-foreground">
                    {[`${project.active} active`, `${project.permanent} permanent`, `${project.archived} archived`].join(' · ')}
                  </p>
                  {project.categories.length > 0 ? (
                    <p className="typography-caption text-muted-foreground">
                      {project.categories.slice(0, 4).map((entry) => `${entry.category}×${entry.count}`).join(' · ')}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </SettingsSection>
      ) : null}
        <SettingsSection divider={false} title={t('settings.page.magicContext.title')}>
          {items.length === 0 ? (
            <p className="typography-body text-muted-foreground">{t('settings.magicContext.empty')}</p>
          ) : (
            <div className="space-y-3">
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('settings.magicContext.searchPlaceholder')}
                className="w-full max-w-sm rounded border border-border bg-transparent px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary"
              />
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
              <div className="flex flex-col items-start gap-2 pt-1">
                <p className="typography-caption text-muted-foreground">
                  {t('settings.magicContext.shownOfTotal', { shown: String(items.length), total: String(total) })}
                </p>
                {items.length < total ? (
                  <>
                    {loadMoreError ? (
                      <p className="typography-body text-muted-foreground">{t('settings.magicContext.loadError')}</p>
                    ) : null}
                    <Button variant="secondary" size="sm" onClick={loadMore}>{t('settings.magicContext.loadMore')}</Button>
                  </>
                ) : null}
              </div>
            </div>
          )}
        </SettingsSection>
        {renderPanels()}
      </>
    );
  };

  return (
    <SettingsPageLayout
      title={t('settings.page.magicContext.title')}
      description={t('settings.magicContext.description')}
    >
      {renderBody()}
    </SettingsPageLayout>
  );
};
