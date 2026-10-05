import { CheckCircle2, CircleDashed, CircleDot, FileUp, Loader2, MinusCircle, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { CURRENT_PHASE_TEXT, currentItem, queueLabel } from '../utils/importQueue';
import type { CurrentPhase, QueueItem, QueueState, QueueStatus } from '../utils/importQueue';

const MUTED_CLS = 'text-gray-600 dark:text-gray-400';

const STATUS_TEXT: Record<QueueStatus, string> = {
  pending: 'Aguardando',
  done: 'Importada',
  skipped: 'Pulada',
  uptodate: 'Já importada',
  failed: 'Falhou',
};

const STATUS_TONE: Record<QueueStatus, string> = {
  pending: 'text-gray-500 dark:text-gray-400',
  done: 'text-green-700 dark:text-green-400',
  skipped: 'text-yellow-700 dark:text-yellow-300',
  uptodate: 'text-gray-500 dark:text-gray-400',
  failed: 'text-red-600 dark:text-red-400',
};

const StatusIcon = ({ status, current, phase }: { status: QueueStatus; current: boolean; phase: CurrentPhase }) => {
  const cls = `h-4 w-4 flex-shrink-0 ${STATUS_TONE[status]}`;
  // The file on screen: a spinner only while a request is in flight; otherwise the icon says where it stands.
  if (current && status === 'pending') {
    const tone = `${cls} text-primary-600 dark:text-primary-400`;
    if (phase === 'loading' || phase === 'confirming') return <Loader2 className={`${tone} animate-spin`} aria-hidden="true" />;
    if (phase === 'ready') return <CircleDot className={tone} aria-hidden="true" />;
    if (phase === 'reconciled') return <MinusCircle className={cls} aria-hidden="true" />;
  }
  if (status === 'done') return <CheckCircle2 className={cls} aria-hidden="true" />;
  if (status === 'skipped' || status === 'uptodate') return <MinusCircle className={cls} aria-hidden="true" />;
  if (status === 'failed') return <XCircle className={cls} aria-hidden="true" />;
  return <CircleDashed className={`${cls} ${current ? 'text-primary-600 dark:text-primary-400' : ''}`} aria-hidden="true" />;
};

interface ProgressListProps {
  state: QueueState;
  /** Where the file on screen stands (default: loading, "Em análise"); the others use the status text. */
  phase?: CurrentPhase;
  /** Texts of the phases that differ for the noun ("Pronto para revisar" for a statement). */
  phaseText?: Partial<Record<CurrentPhase, string>>;
  /** Where the lists of the nouns differ ("Importada" for a card invoice, "Importado" for a statement). */
  statusText?: Partial<Record<QueueStatus, string>>;
}

/** One line per file with where it stands. */
export const QueueProgressList = ({ state, phase = 'loading', phaseText, statusText }: ProgressListProps) => (
  <ol aria-label="Progresso da fila" className="space-y-1 text-sm">
    {state.items.map((item: QueueItem, index) => {
      const isCurrent = index === state.index;
      const label = isCurrent && item.status === 'pending' ? (phaseText?.[phase] ?? CURRENT_PHASE_TEXT[phase]) : (statusText?.[item.status] ?? STATUS_TEXT[item.status]);
      return (
        <li key={item.id} aria-current={isCurrent ? 'step' : undefined} className="flex flex-wrap items-center gap-x-2 min-w-0">
          <StatusIcon status={item.status} current={isCurrent} phase={phase} />
          <span className={`truncate max-w-[260px] ${isCurrent ? 'font-medium text-gray-900 dark:text-white' : MUTED_CLS}`} title={item.name}>
            {item.name}
          </span>
          <span className={`text-xs ${STATUS_TONE[item.status]}`}>{label}</span>
          {item.note && <span className={`text-xs ${MUTED_CLS} truncate max-w-[360px]`} title={item.note}>{item.note}</span>}
        </li>
      );
    })}
  </ol>
);

interface QueueHeaderProps {
  state: QueueState;
  /** "Fatura" / "Arquivo". */
  noun: string;
  /** Status texts that differ from the defaults ("Importado" for a statement). */
  statusText?: ProgressListProps['statusText'];
  phase?: CurrentPhase;
  phaseText?: ProgressListProps['phaseText'];
  children?: ReactNode;
}

/** "Fatura 3 de 10", the name of the file, and the progress list; `children` goes below (queue-wide settings). */
export const QueueHeader = ({ state, noun, statusText, phase, phaseText, children }: QueueHeaderProps) => {
  const item = currentItem(state);
  return (
    <section aria-label="Fila de importação" className="space-y-3 rounded-md border border-gray-200 dark:border-gray-800 p-3 min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 min-w-0">
        <h4 className="text-sm font-medium text-gray-900 dark:text-white">{queueLabel(state, noun)}</h4>
        {item && (
          <span className={`inline-flex items-center gap-1 text-sm min-w-0 ${MUTED_CLS}`}>
            <FileUp className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <span className="truncate" title={item.name}>{item.name}</span>
          </span>
        )}
      </div>
      <QueueProgressList state={state} statusText={statusText} phase={phase} phaseText={phaseText} />
      {children}
    </section>
  );
};
