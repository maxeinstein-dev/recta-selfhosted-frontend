import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addMonths, subMonths, format } from 'date-fns';
import { ptBR as ptBRLocale } from 'date-fns/locale/pt-BR';
import { enUS as enUSLocale } from 'date-fns/locale/en-US';
import { es as esLocale } from 'date-fns/locale/es';
import { fr as frLocale } from 'date-fns/locale/fr';
import { ru as ruLocale } from 'date-fns/locale/ru';
import { ja as jaLocale } from 'date-fns/locale/ja';
import { zhCN as zhCNLocale } from 'date-fns/locale/zh-CN';
import { arSA as arSALocale } from 'date-fns/locale/ar-SA';
import { Locale } from '../../context/I18nContext';

interface MonthNavigatorProps {
  selectedMonth: Date;
  onMonthChange: (month: Date) => void;
  locale?: Locale;
  className?: string;
}

const localeMap: Record<Locale, any> = {
  'pt-BR': ptBRLocale,
  'en-US': enUSLocale,
  'es-ES': esLocale,
  'fr-FR': frLocale,
  'ru-RU': ruLocale,
  'ja-JP': jaLocale,
  'zh-CN': zhCNLocale,
  'ar-SA': arSALocale,
};

export const MonthNavigator = ({ 
  selectedMonth, 
  onMonthChange, 
  locale = 'pt-BR',
  className = '' 
}: MonthNavigatorProps) => {
  const currentLocale = localeMap[locale] || ptBRLocale;

  const handlePrevMonth = () => {
    onMonthChange(subMonths(selectedMonth, 1));
  };

  const handleNextMonth = () => {
    onMonthChange(addMonths(selectedMonth, 1));
  };

  const formattedMonth = format(selectedMonth, 'MMMM yyyy', { locale: currentLocale });

  return (
    <div className={`flex items-center justify-between ${className}`}>
      <button
        onClick={handlePrevMonth}
        type="button"
        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
        aria-label="Mês anterior"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      
      <span className="text-lg font-medium px-2 capitalize text-center" aria-live="polite">
        {formattedMonth}
      </span>
      
      <button
        onClick={handleNextMonth}
        type="button"
        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
        aria-label="Próximo mês"
      >
        <ChevronRight className="h-5 w-5" />
      </button>
    </div>
  );
};
