import { useEffect, useMemo, useRef, useState } from 'react';
import { Tag } from 'lucide-react';
import { useCreateCategory, useUpdateCategory } from '../../hooks/api/useCategories';
import { useToastContext } from '../../context/ToastContext';
import { useI18n } from '../../context/I18nContext';
import { CategoryType, getCategoryDisplayName } from '../../lib/enums';
import {
  CATEGORY_COLORS,
  DEFAULT_CATEGORY_COLOR,
  MAX_CATEGORY_NAME,
  buildUpdatePatch,
  categoryFailureMessage,
  normalizeColor,
  validateCategoryName,
} from '../../utils/categoryManager';
import type { CategoryKind, ManagedCategory } from '../../utils/categoryManager';
import { BTN_PRIMARY, BTN_SECONDARY, DialogShell, ERROR_CLS, INPUT_CLS, LABEL_CLS, MUTED_CLS } from '../people/ui';

interface CategoryFormDialogProps {
  open: boolean;
  onClose: () => void;
  householdId: string | undefined;
  /** The custom category being edited; null creates one. */
  category: ManagedCategory | null;
  /** Type preselected for a new category. */
  defaultType: CategoryKind;
  /** Every listed category (system and custom): names are checked against them. */
  categories: ManagedCategory[];
}

/** Create or edit a custom category: name, colour and (only when creating) the type. Rename is safe: rows point at the id. */
const CategoryFormDialog = ({ open, onClose, householdId, category, defaultType, categories }: CategoryFormDialogProps) => {
  const { t } = useI18n();
  const { success, error: showError } = useToastContext();
  const createMutation = useCreateCategory();
  const updateMutation = useUpdateCategory();
  const [name, setName] = useState('');
  const [type, setType] = useState<CategoryKind>(defaultType);
  const [color, setColor] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  // Seeded when it opens (or when another category is edited): a refetch of the list must not wipe what is being typed.
  const categoryRef = useRef(category);
  categoryRef.current = category;
  useEffect(() => {
    if (!open) return;
    const current = categoryRef.current;
    setName(current?.name ?? '');
    setType(current?.type ?? defaultType);
    setColor(normalizeColor(current?.color) ?? null);
    setFormError(null);
  }, [open, category?.id, defaultType]);

  const systemLabel = useMemo(() => (c: ManagedCategory) => getCategoryDisplayName(c.id, t as unknown as Record<string, string>), [t]);
  const check = useMemo(
    () => validateCategoryName(name, type, categories, systemLabel, category?.id ?? null),
    [name, type, categories, systemLabel, category?.id],
  );
  const unchanged = category ? buildUpdatePatch(category, { name: check.name, color }) === null : false;

  const handleSave = async () => {
    if (savingRef.current) return;
    if (!check.ok) {
      setFormError(check.message ?? 'Revise o nome.');
      return;
    }
    if (!householdId) {
      setFormError('Nenhuma conta selecionada.');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setFormError(null);
    try {
      if (category) {
        const patch = buildUpdatePatch(category, { name: check.name, color });
        if (patch) await updateMutation.mutateAsync({ id: category.id, ...patch });
        success('Categoria atualizada.');
      } else {
        await createMutation.mutateAsync({ householdId, name: check.name, type: type as CategoryType, color });
        success('Categoria criada.');
      }
      onClose();
    } catch (err: unknown) {
      const message = categoryFailureMessage(err);
      setFormError(message);
      showError(message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <DialogShell open={open} onClose={onClose} canClose={!saving} titleId="category-form-title" widthClass="max-w-md"
      title={category ? 'Editar categoria' : 'Nova categoria'} icon={<Tag className="h-5 w-5 text-gray-500 dark:text-gray-400 mr-3 flex-shrink-0" aria-hidden="true" />}>
      <form className="space-y-4 min-w-0" onSubmit={(e) => { e.preventDefault(); void handleSave(); }}>
        <div>
          <label htmlFor="category-name" className={LABEL_CLS}>Nome</label>
          <input id="category-name" type="text" value={name} maxLength={MAX_CATEGORY_NAME} disabled={saving} className={INPUT_CLS}
            placeholder="Ex.: Vale Alimentação" onChange={(e) => setName(e.target.value)} />
        </div>
        {!category && (
          <div>
            <label htmlFor="category-type" className={LABEL_CLS}>Tipo</label>
            <select id="category-type" value={type} disabled={saving} className={INPUT_CLS} onChange={(e) => setType(e.target.value as CategoryKind)}>
              <option value="INCOME">Receita</option>
              <option value="EXPENSE">Despesa</option>
            </select>
          </div>
        )}
        <fieldset>
          <legend className={LABEL_CLS}>Cor</legend>
          <div className="flex flex-wrap gap-2">
            {CATEGORY_COLORS.map((swatch) => (
              <button key={swatch} type="button" disabled={saving} aria-label={`Cor ${swatch}`} aria-pressed={color === swatch}
                onClick={() => setColor(color === swatch ? null : swatch)}
                className={`h-7 w-7 rounded-full border-2 ${color === swatch ? 'border-gray-900 dark:border-white' : 'border-transparent'} disabled:opacity-50`}
                style={{ backgroundColor: swatch }} />
            ))}
          </div>
          <p className={`mt-2 text-xs ${MUTED_CLS}`}>
            {color ? 'Toque na cor escolhida para voltar à cor padrão.' : <>Sem cor escolhida: usa a cor padrão (<span style={{ color: DEFAULT_CATEGORY_COLOR }}>cinza</span>).</>}
          </p>
        </fieldset>
        {category && <p className={`text-xs ${MUTED_CLS}`}>Renomear não muda as transações: elas continuam ligadas a esta categoria.</p>}
        {(formError || (name.trim() && !check.ok)) && <p role="alert" className={ERROR_CLS}>{formError ?? check.message}</p>}
        <div className="flex gap-3 justify-end pt-2">
          <button type="button" onClick={onClose} disabled={saving} className={BTN_SECONDARY}>Cancelar</button>
          <button type="submit" disabled={saving || !check.ok || unchanged} className={BTN_PRIMARY}>
            {saving ? 'Salvando…' : category ? 'Salvar' : 'Criar'}
          </button>
        </div>
      </form>
    </DialogShell>
  );
};

export default CategoryFormDialog;
