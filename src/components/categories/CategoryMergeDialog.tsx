import { useEffect, useMemo, useRef, useState } from 'react';
import { Merge } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { previewMergeCategory, useMergeCategory } from '../../hooks/api/useCategories';
import type { MergeCategoryResult } from '../../hooks/api/useCategories';
import { useToastContext } from '../../context/ToastContext';
import { useI18n } from '../../context/I18nContext';
import { getCategoryDisplayName } from '../../lib/enums';
import {
  buildMergeRequest,
  categoryFailureMessage,
  mergeBudgetNote,
  mergePreviewSentence,
  mergeTargets,
} from '../../utils/categoryManager';
import type { ManagedCategory, MergeTargetOption } from '../../utils/categoryManager';
import { BTN_DANGER, BTN_SECONDARY, DialogShell, ERROR_CLS, INPUT_CLS, LABEL_CLS, MUTED_CLS, NOTICE_BOX_CLS } from '../people/ui';

interface CategoryMergeDialogProps {
  open: boolean;
  onClose: () => void;
  /** The custom category that disappears (its rows move to the target). */
  source: ManagedCategory | null;
  categories: ManagedCategory[];
}

const targetKey = (t: MergeTargetOption): string => `${t.kind}:${t.id}`;

/** "Unir com…": pick the category that stays, see how many rows move (server preview), confirm. */
const CategoryMergeDialog = ({ open, onClose, source, categories }: CategoryMergeDialogProps) => {
  const { t } = useI18n();
  const { success, error: showError } = useToastContext();
  const mergeMutation = useMergeCategory();
  const queryClient = useQueryClient();
  const systemLabel = useMemo(() => (c: ManagedCategory) => getCategoryDisplayName(c.id, t as unknown as Record<string, string>), [t]);
  const targets = useMemo(() => (source ? mergeTargets(source, categories, systemLabel) : []), [source, categories, systemLabel]);
  const [selected, setSelected] = useState('');
  const [preview, setPreview] = useState<MergeCategoryResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const mergingRef = useRef(false);
  // Latest wins: only the answer of the newest preview request is kept (a slow answer for an earlier pick is dropped).
  const requestSeq = useRef(0);

  const sourceRef = useRef(source);
  sourceRef.current = source;
  useEffect(() => {
    if (!open) return;
    requestSeq.current += 1;
    setSelected('');
    setPreview(null);
    setPreviewing(false);
    setError(null);
  }, [open, source?.id]);

  const target = targets.find((option) => targetKey(option) === selected) ?? null;

  const pick = (key: string) => {
    setSelected(key);
    setPreview(null);
    setError(null);
    const option = targets.find((o) => targetKey(o) === key);
    const current = sourceRef.current;
    const seq = ++requestSeq.current;
    if (!option || !current) {
      setPreviewing(false);
      return;
    }
    setPreviewing(true);
    previewMergeCategory(current.id, buildMergeRequest(current.id, option, true).body)
      .then((result) => {
        if (seq !== requestSeq.current) return;
        setPreview(result);
      })
      .catch((err: unknown) => {
        if (seq !== requestSeq.current) return;
        setError(categoryFailureMessage(err));
        // Gone already (merged elsewhere)? Refresh the list so the dialog's own targets are not stale.
        if ((err as { status?: number } | null)?.status === 404) void queryClient.invalidateQueries({ queryKey: ['categories'] });
      })
      .finally(() => {
        if (seq === requestSeq.current) setPreviewing(false);
      });
  };

  const confirm = async () => {
    if (mergingRef.current || !source || !target || !previewReady) return;
    mergingRef.current = true;
    setMerging(true);
    setError(null);
    try {
      await mergeMutation.mutateAsync({ sourceId: source.id, body: buildMergeRequest(source.id, target, false).body });
      success(`"${source.name}" foi unida com "${target.label}".`);
      onClose();
    } catch (err: unknown) {
      const message = categoryFailureMessage(err);
      setError(message);
      showError(message);
    } finally {
      mergingRef.current = false;
      setMerging(false);
    }
  };

  // The preview on screen must be the one of the target picked now (never the answer of an earlier pick).
  const previewReady = preview && target && preview.target.id === target.id && preview.target.isSystem === (target.kind === 'system') ? preview : null;
  const note = previewReady ? mergeBudgetNote(previewReady.counts) : null;
  return (
    <DialogShell open={open && !!source} onClose={onClose} canClose={!merging} titleId="category-merge-title" widthClass="max-w-lg"
      title={source ? `Unir "${source.name}" com…` : 'Unir categorias'} icon={<Merge className="h-5 w-5 text-gray-500 dark:text-gray-400 mr-3 flex-shrink-0" aria-hidden="true" />}>
      {source && (
        <div className="space-y-4 min-w-0">
          <p className={`text-sm ${MUTED_CLS}`}>
            Tudo que está em <strong>{source.name}</strong> passa para a categoria que você escolher, e <strong>{source.name}</strong> deixa de existir.
            Só dá para unir categorias do mesmo tipo.
          </p>
          {targets.length === 0 ? (
            <p className={`text-sm ${MUTED_CLS}`}>Não há outra categoria deste tipo para receber os lançamentos.</p>
          ) : (
            <div>
              <label htmlFor="category-merge-target" className={LABEL_CLS}>Manter a categoria</label>
              <select id="category-merge-target" value={selected} disabled={merging} className={INPUT_CLS} onChange={(e) => pick(e.target.value)}>
                <option value="">Escolha…</option>
                <optgroup label="Suas categorias">
                  {targets.filter((o) => o.kind === 'custom').map((o) => <option key={targetKey(o)} value={targetKey(o)}>{o.label}</option>)}
                </optgroup>
                <optgroup label="Padrão do Recta">
                  {targets.filter((o) => o.kind === 'system').map((o) => <option key={targetKey(o)} value={targetKey(o)}>{o.label}</option>)}
                </optgroup>
              </select>
            </div>
          )}
          {previewing && <p className={`text-sm ${MUTED_CLS}`} role="status">Calculando…</p>}
          {previewReady && target && (
            <div className={NOTICE_BOX_CLS} role="status">
              <p>{mergePreviewSentence(previewReady.counts, target.label)}</p>
              {note && <p>{note}</p>}
              <p className="text-xs">Esta ação não pode ser desfeita.</p>
            </div>
          )}
          {error && <p role="alert" className={ERROR_CLS}>{error}</p>}
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={onClose} disabled={merging} className={BTN_SECONDARY}>Cancelar</button>
            <button type="button" onClick={() => void confirm()} disabled={merging || previewing || !previewReady || !target} className={BTN_DANGER}>
              {merging ? 'Unindo…' : 'Unir categorias'}
            </button>
          </div>
        </div>
      )}
    </DialogShell>
  );
};

export default CategoryMergeDialog;
