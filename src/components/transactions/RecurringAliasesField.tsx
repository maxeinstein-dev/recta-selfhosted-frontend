import { useState } from 'react';
import { useI18n } from '../../context/I18nContext';
import { MAX_ALIAS_LENGTH, addAlias, removeAlias } from '../../utils/recurringAliases';

interface RecurringAliasesFieldProps {
  value: string[];
  onChange: (aliases: string[]) => void;
  disabled?: boolean;
}

/** "Outros nomes no banco": the names the bank or the card machine prints for the charge, so an import is not duplicated. */
export const RecurringAliasesField = ({ value, onChange, disabled = false }: RecurringAliasesFieldProps) => {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const commit = () => {
    if (!text.trim()) {
      setProblem(null);
      return;
    }
    const result = addAlias(value, text);
    if (result.ok) {
      onChange(result.aliases);
      setText('');
      setProblem(null);
      return;
    }
    setProblem(
      result.reason === 'duplicate'
        ? t.recurringAliasDuplicate || 'Esse nome já está na lista.'
        : result.reason === 'limit'
          ? t.recurringAliasLimit || 'Limite de apelidos atingido.'
          : t.recurringAliasEmpty || 'Digite um nome com letras ou números.',
    );
  };

  return (
    <div data-testid="recurring-aliases-field">
      <label htmlFor="recurring-alias-input" className="block text-sm font-light text-gray-500 dark:text-gray-400 mb-2">
        {t.recurringAliasesLabel || 'Outros nomes no banco (apelidos)'}
      </label>
      <div className="flex gap-2">
        <input
          id="recurring-alias-input"
          type="text"
          value={text}
          maxLength={MAX_ALIAS_LENGTH}
          disabled={disabled}
          placeholder={t.recurringAliasesPlaceholder || 'Ex.: Pg *Nome da Loja'}
          onChange={(e) => {
            setText(e.target.value);
            setProblem(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
          onBlur={commit}
          aria-invalid={problem ? true : undefined}
          className="block w-full px-3 py-2.5 border border-gray-200 dark:border-gray-800 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:border-primary-500 sm:text-sm font-light tracking-tight"
        />
        <button
          type="button"
          onClick={commit}
          disabled={disabled || !text.trim()}
          className="px-3 py-2.5 border border-gray-200 dark:border-gray-800 rounded-md text-sm font-light tracking-tight text-gray-900 dark:text-white bg-white dark:bg-gray-900 hover:opacity-70 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {t.recurringAliasAdd || 'Adicionar'}
        </button>
      </div>
      {problem && (
        <p role="alert" className="mt-1 text-sm text-red-600 dark:text-red-400">
          {problem}
        </p>
      )}
      {value.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {value.map((alias, index) => (
            <li
              key={`${alias}-${index}`}
              className="inline-flex items-center gap-1 px-2 py-1 border border-gray-200 dark:border-gray-800 rounded-md text-xs font-light text-gray-900 dark:text-white"
            >
              <span>{alias}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(removeAlias(value, index))}
                aria-label={`${t.recurringAliasRemove || 'Remover'} ${alias}`}
                className="text-gray-500 dark:text-gray-400 hover:opacity-70"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-xs font-light text-gray-500 dark:text-gray-400">
        {t.recurringAliasesHelp ||
          'O banco ou a maquininha pode mostrar outro nome para esta cobrança. Se um lançamento importado tiver o nome da recorrência ou um destes nomes, ele é usado em vez de criar outro no mês.'}
      </p>
    </div>
  );
};
