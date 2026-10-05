import { useEffect, useMemo, useRef, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { useCreatePerson, usePeople, useUpdatePerson } from '../../hooks/api/usePeople';
import type { Person } from '../../hooks/api/usePeople';
import { useToastContext } from '../../context/ToastContext';
import { cleanAliases, parseAliasText, personSaveFailureMessage, validatePersonForm } from '../../utils/people';
import { BTN_PRIMARY, BTN_SECONDARY, CHECKBOX_CLS, DialogShell, ERROR_CLS, INPUT_CLS, LABEL_CLS, MUTED_CLS } from './ui';

interface PersonFormDialogProps {
  open: boolean;
  onClose: () => void;
  householdId: string | undefined;
  /** The person being edited; null creates one. */
  person: Person | null;
  /** Called with the saved person (the Dividir dialog selects the new one in its row). */
  onSaved?: (person: Person) => void;
  initialName?: string;
  /** Stacking level when opened from another dialog. */
  zClass?: string;
}

/** Add or edit a person: name, aliases (comma separated) and, when editing, whether she is active. */
const PersonFormDialog = ({ open, onClose, householdId, person, onSaved, initialName = '', zClass }: PersonFormDialogProps) => {
  const { success, error: showError } = useToastContext();
  const { data: allPeople } = usePeople(householdId, true);
  const createMutation = useCreatePerson();
  const updateMutation = useUpdatePerson();
  const [name, setName] = useState('');
  const [aliasText, setAliasText] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);

  // The form is seeded when it opens (or when another person is edited): a refetch of the same person must not wipe
  // what the user is typing.
  const personRef = useRef(person);
  personRef.current = person;
  useEffect(() => {
    if (!open) return;
    const current = personRef.current;
    setName(current?.name ?? initialName);
    setAliasText(current ? current.aliases.join(', ') : '');
    setIsActive(current?.isActive ?? true);
    setFormError(null);
  }, [open, person?.id, initialName]);

  const aliases = useMemo(() => cleanAliases(name, parseAliasText(aliasText)), [name, aliasText]);
  const check = useMemo(() => validatePersonForm(name, aliases, allPeople ?? [], person?.id ?? null), [name, aliases, allPeople, person]);

  const handleSave = async () => {
    if (savingRef.current) return;
    if (!check.ok) {
      setFormError(check.name ?? check.conflict ?? 'Revise os dados.');
      return;
    }
    if (!householdId) {
      setFormError('Nenhuma household selecionada.');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setFormError(null);
    try {
      const saved = person
        ? await updateMutation.mutateAsync({ id: person.id, name: name.trim(), aliases, isActive })
        : await createMutation.mutateAsync({ householdId, name: name.trim(), aliases });
      success(person ? 'Pessoa atualizada.' : 'Pessoa cadastrada.');
      onSaved?.(saved);
      onClose();
    } catch (err: unknown) {
      const message = personSaveFailureMessage(err);
      setFormError(message);
      showError(message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <DialogShell open={open} onClose={onClose} canClose={!saving} titleId="person-form-title" widthClass="max-w-lg" zClass={zClass}
      title={person ? 'Editar pessoa' : 'Nova pessoa'} icon={<UserPlus className="h-5 w-5 text-gray-500 dark:text-gray-400 mr-3 flex-shrink-0" aria-hidden="true" />}>
      <div className="space-y-4 min-w-0">
        <div>
          <label htmlFor="person-name" className={LABEL_CLS}>Nome</label>
          <input id="person-name" type="text" value={name} maxLength={80} disabled={saving} className={INPUT_CLS} autoFocus
            onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="person-aliases" className={LABEL_CLS}>Apelidos</label>
          <input id="person-aliases" type="text" value={aliasText} disabled={saving} className={INPUT_CLS} placeholder="Separe por vírgula"
            onChange={(e) => setAliasText(e.target.value)} />
          <p className={`mt-1 text-xs ${MUTED_CLS}`}>
            Como a pessoa aparece nas planilhas e nas notas. Nome e apelidos não podem repetir os de outra pessoa.
          </p>
        </div>
        {person && (
          <label htmlFor="person-active" className="inline-flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100 cursor-pointer">
            <input id="person-active" type="checkbox" checked={isActive} disabled={saving} className={CHECKBOX_CLS}
              onChange={(e) => setIsActive(e.target.checked)} />
            Pessoa ativa
          </label>
        )}
        {(formError || (!check.ok && (check.conflict || name.trim()))) && (
          <p role="alert" className={ERROR_CLS}>{formError ?? check.conflict}</p>
        )}
        <div className="flex gap-3 justify-end pt-2">
          <button type="button" onClick={onClose} disabled={saving} className={BTN_SECONDARY}>Cancelar</button>
          <button type="button" onClick={() => void handleSave()} disabled={saving || !check.ok} className={BTN_PRIMARY}>
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </DialogShell>
  );
};

export default PersonFormDialog;
