import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Home, Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { useToastContext } from '../../context/ToastContext';
import {
  useAssignCategoryGroup,
  useCategoryGroups,
  useCreateCategoryGroup,
  useDeleteCategoryGroup,
  useUpdateCategoryGroup,
} from '../../hooks/api/useCategoryGroups';
import { categoryRows, groupNameError, groupOptions, OTHER_NAME, type CategoryGroup } from '../../utils/incomeSplit';
import ConfirmModal from '../ConfirmModal';
import { BTN_PRIMARY, BTN_SECONDARY_SM, ERROR_CLS, INPUT_SM_CLS, MUTED_CLS } from '../people/ui';

interface Props {
  householdId: string | undefined;
  /** EDITOR or more; a viewer only reads. */
  canEdit: boolean;
}

const OTHER_DROP = '__other__';
const errorMessage = (err: unknown, fallback: string): string => {
  const data = (err as { response?: { data?: { error?: { message?: string }; message?: string } } })?.response?.data;
  return data?.error?.message || data?.message || fallback;
};

/**
 * Settings section (P05): the spending groups above the expense categories (Casa, Pessoal, Dia a dia…). Create, rename,
 * mark as housing, delete (its categories go back to "Outros"), and put each category in a group: a selector per
 * category everywhere (dragging is hard on a phone), plus drag and drop between the boxes on a computer.
 * Reached from Ajustes (on the phone, in the "Mais" menu) and from the Início through #grupos-de-gasto.
 */
export default function SpendingGroupsManager({ householdId, canEdit }: Props) {
  const { success, error: showError } = useToastContext();
  const location = useLocation();
  const sectionRef = useRef<HTMLDivElement>(null);
  const { data, isLoading, isError } = useCategoryGroups(householdId);
  const createMutation = useCreateCategoryGroup(householdId);
  const updateMutation = useUpdateCategoryGroup(householdId);
  const deleteMutation = useDeleteCategoryGroup(householdId);
  const assignMutation = useAssignCategoryGroup(householdId);

  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<CategoryGroup | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const groups = data?.groups ?? [];
  const rows = useMemo(() => (data ? categoryRows(data) : []), [data]);
  const options = useMemo(() => (data ? groupOptions(data) : []), [data]);
  const newNameError = newName.trim() ? groupNameError(newName, groups) : null;

  useEffect(() => {
    if (location.hash === '#grupos-de-gasto' && data) sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location.hash, data]);

  const assign = (categoryName: string, value: string) => {
    assignMutation.mutate(
      { categoryName, groupId: value || null },
      { onError: (err) => showError(errorMessage(err, 'Não foi possível mover a categoria.')) },
    );
  };

  const create = async () => {
    const err = groupNameError(newName, groups);
    if (err) return showError(err);
    try {
      await createMutation.mutateAsync({ name: newName.trim() });
      setNewName('');
      success('Grupo criado.');
    } catch (e) {
      showError(errorMessage(e, 'Não foi possível criar o grupo.'));
    }
  };

  const rename = async () => {
    if (!editing) return;
    const err = groupNameError(editing.name, groups, editing.id);
    if (err) return showError(err);
    try {
      await updateMutation.mutateAsync({ id: editing.id, name: editing.name.trim() });
      setEditing(null);
    } catch (e) {
      showError(errorMessage(e, 'Não foi possível renomear o grupo.'));
    }
  };

  const toggleHousing = (g: CategoryGroup) =>
    updateMutation.mutate({ id: g.id, isHousing: !g.isHousing }, { onError: (e) => showError(errorMessage(e, 'Não foi possível mudar a moradia.')) });

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteMutation.mutateAsync(deleting.id);
      success('Grupo excluído. As categorias dele foram para "Outros".');
    } catch (e) {
      showError(errorMessage(e, 'Não foi possível excluir o grupo.'));
    }
    setDeleting(null);
  };

  const dropProps = (target: string) =>
    canEdit
      ? {
          onDragOver: (e: React.DragEvent) => {
            if (dragging) e.preventDefault();
          },
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            const name = e.dataTransfer.getData('text/plain') || dragging;
            setDragging(null);
            if (name) assign(name, target === OTHER_DROP ? '' : target);
          },
        }
      : {};

  const chip = (c: { categoryName: string; name: string }) => (
    <li
      key={c.categoryName}
      draggable={canEdit}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', c.categoryName);
        setDragging(c.categoryName);
      }}
      onDragEnd={() => setDragging(null)}
      className={`rounded-full border border-gray-200 dark:border-gray-700 px-2.5 py-1 text-xs text-gray-800 dark:text-gray-200 ${canEdit ? 'cursor-grab' : ''}`}
    >
      {c.name}
    </li>
  );

  return (
    <div id="grupos-de-gasto" ref={sectionRef} className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-lg p-4 sm:p-6 mb-4 sm:mb-6 scroll-mt-20" data-testid="spending-groups">
      <h2 className="text-lg sm:text-xl font-light tracking-tight text-gray-900 dark:text-white mb-2 flex items-center">
        <Layers className="h-5 w-5 mr-2" aria-hidden="true" />
        Grupos de gasto
      </h2>
      <p className={`text-sm font-light mb-4 ${MUTED_CLS}`}>
        Os grupos juntam categorias de despesa para mostrar, no Início, para onde vai a renda do mês. Marque o grupo da
        moradia para ver quanto dela vai para a casa. Categoria sem grupo entra em "{OTHER_NAME}".
      </p>

      {isLoading && <p className={`text-sm ${MUTED_CLS}`} role="status">Carregando grupos…</p>}
      {isError && <p className="text-sm text-red-600 dark:text-red-400" role="alert">Não foi possível carregar os grupos.</p>}

      {data && (
        <>
          {/* Groups: rename, housing, delete; on a computer, drop categories on a box */}
          <div className="grid gap-3 md:grid-cols-2 mb-4">
            {groups.map((g) => (
              <section
                key={g.id}
                aria-label={`Grupo ${g.name}`}
                className={`rounded-md border p-3 ${dragging ? 'border-primary-400 border-dashed' : 'border-gray-100 dark:border-gray-800'}`}
                {...dropProps(g.id)}
                data-testid={`group-${g.name}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: g.color ?? '#94A3B8' }} aria-hidden="true" />
                  {editing?.id === g.id ? (
                    <form className="flex flex-1 items-center gap-2" onSubmit={(e) => { e.preventDefault(); void rename(); }}>
                      <input className={INPUT_SM_CLS} value={editing.name} onChange={(e) => setEditing({ id: g.id, name: e.target.value })} aria-label={`Novo nome de ${g.name}`} autoFocus maxLength={80} />
                      <button type="submit" className={BTN_SECONDARY_SM} disabled={updateMutation.isPending}>Salvar</button>
                      <button type="button" className={BTN_SECONDARY_SM} onClick={() => setEditing(null)}>Cancelar</button>
                    </form>
                  ) : (
                    <span className="flex-1 font-medium text-gray-900 dark:text-white">{g.name}</span>
                  )}
                  {g.isHousing && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary-50 dark:bg-primary-900/30 px-2 py-0.5 text-xs text-primary-700 dark:text-primary-300">
                      <Home className="h-3 w-3" aria-hidden="true" /> Moradia
                    </span>
                  )}
                  {canEdit && editing?.id !== g.id && (
                    <span className="flex items-center">
                      <button type="button" className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center md:min-h-0 md:min-w-0 p-2 text-gray-500 hover:text-primary-600" onClick={() => setEditing({ id: g.id, name: g.name })} aria-label={`Renomear ${g.name}`} title="Renomear">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button type="button" className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center md:min-h-0 md:min-w-0 p-2 text-gray-500 hover:text-red-600" onClick={() => setDeleting(g)} aria-label={`Excluir ${g.name}`} title="Excluir">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </span>
                  )}
                </div>
                {canEdit && (
                  <label className={`mt-2 flex items-center gap-2 text-sm ${MUTED_CLS}`}>
                    <input type="checkbox" checked={g.isHousing} onChange={() => toggleHousing(g)} className="h-5 w-5 shrink-0" />
                    É moradia (aluguel, condomínio, luz, internet, financiamento)
                  </label>
                )}
                <ul className="mt-2 flex flex-wrap gap-1.5 min-h-[28px]" aria-label={`Categorias de ${g.name}`}>
                  {g.categories.map(chip)}
                  {g.categories.length === 0 && <li className={`text-xs ${MUTED_CLS}`}>Nenhuma categoria.</li>}
                </ul>
              </section>
            ))}
            <section aria-label={`Grupo ${OTHER_NAME}`} className={`rounded-md border p-3 ${dragging ? 'border-primary-400 border-dashed' : 'border-gray-100 dark:border-gray-800'} bg-gray-50/50 dark:bg-gray-800/30`} {...dropProps(OTHER_DROP)} data-testid="group-Outros">
              <span className="font-medium text-gray-900 dark:text-white">{OTHER_NAME}</span>
              <span className={`ml-2 text-xs ${MUTED_CLS}`}>categorias sem grupo</span>
              <ul className="mt-2 flex flex-wrap gap-1.5 min-h-[28px]" aria-label="Categorias sem grupo">
                {data.ungrouped.map(chip)}
                {data.ungrouped.length === 0 && <li className={`text-xs ${MUTED_CLS}`}>Todas as categorias têm grupo.</li>}
              </ul>
            </section>
          </div>

          {canEdit && (
            <form className="mb-5" onSubmit={(e) => { e.preventDefault(); void create(); }}>
              <div className="flex gap-2">
                <input className={INPUT_SM_CLS} placeholder="Novo grupo (ex.: Viagens)" value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="Nome do novo grupo" maxLength={80} />
                <button type="submit" className={`${BTN_PRIMARY} gap-1 !px-3 !py-1.5 whitespace-nowrap`} disabled={!newName.trim() || !!newNameError || createMutation.isPending}>
                  <Plus className="h-4 w-4" aria-hidden="true" /> Criar
                </button>
              </div>
              {newNameError && <p className={`${ERROR_CLS} mt-1`}>{newNameError}</p>}
            </form>
          )}

          {/* One selector per category: the way to move a category on a phone (and without a mouse) */}
          <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-2">Categoria por grupo</h3>
          <ul className="divide-y divide-gray-100 dark:divide-gray-800" data-testid="category-group-rows">
            {rows.map((r) => (
              <li key={r.categoryName} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate text-sm text-gray-900 dark:text-white">{r.name}</span>
                <select
                  className={`${INPUT_SM_CLS} !w-40 shrink-0 min-h-[44px] sm:min-h-0`}
                  value={r.groupId}
                  disabled={!canEdit}
                  onChange={(e) => assign(r.categoryName, e.target.value)}
                  aria-label={`Grupo de ${r.name}`}
                >
                  {options.map((o) => (
                    <option key={o.value || 'other'} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </>
      )}

      <ConfirmModal
        isOpen={!!deleting}
        onClose={() => { if (!deleteMutation.isPending) setDeleting(null); }}
        onConfirm={() => void confirmDelete()}
        title="Excluir grupo"
        message={`Excluir o grupo "${deleting?.name ?? ''}"? As categorias dele vão para "${OTHER_NAME}". Nenhum lançamento muda.`}
        variant="danger"
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
