import { startOfMonth, endOfMonth, isWithinInterval, subMonths, isBefore, isAfter, isSameDay, addDays, addWeeks, addMonths, addYears } from 'date-fns';
import { Transaction, CategoryData, MonthlyComparison, RecurringTransaction, Account } from '../types';
import { TransactionType, AccountType } from '../lib/enums';
import { effectiveMonthOf, monthKeyOf } from './referenceMonth';
import { projectedOccurrenceAmount } from './forecastStrategy';

export const getTotalIncome = (transactions: Transaction[] | undefined): number => {
  if (!transactions || !Array.isArray(transactions)) {
    return 0;
  }
  return transactions
    .filter(t => t.type === TransactionType.INCOME)
    .reduce((sum, t) => sum + (t.amount || 0), 0);
};

export const getTotalExpense = (transactions: Transaction[] | undefined): number => {
  if (!transactions || !Array.isArray(transactions)) {
    return 0;
  }
  return transactions
    .filter(t => t.type === TransactionType.EXPENSE)
    .reduce((sum, t) => sum + (t.amount || 0), 0);
};

export const getBalance = (transactions: Transaction[] | undefined): number => {
  return getTotalIncome(transactions) - getTotalExpense(transactions);
};

/**
 * The transactions that count in `date`'s month for month planning: those whose reference month (competencia) is that
 * month, or, with no reference month, whose date is in it. A row dated 25 Sep that refers to October counts in October.
 */
export const getTransactionsByMonth = (transactions: Transaction[] | undefined, date: Date = new Date()): Transaction[] => {
  if (!transactions || !Array.isArray(transactions)) {
    return [];
  }

  const target = monthKeyOf(date);

  return transactions.filter(t => {
    if (!t || !t.date) return false;
    return effectiveMonthOf({ date: t.date, competenceMonth: t.competenceMonth, type: t.type }) === target;
  });
};

/**
 * The transactions whose DATE is in `date`'s month (the calendar of the money, balances, daily views): the reference
 * month is ignored. Month planning uses getTransactionsByMonth.
 */
export const getTransactionsByDateMonth = (transactions: Transaction[] | undefined, date: Date = new Date()): Transaction[] => {
  if (!transactions || !Array.isArray(transactions)) {
    return [];
  }

  const start = startOfMonth(date);
  const end = endOfMonth(date);

  return transactions.filter(t => {
    if (!t || !t.date) return false;
    // Convert string date to Date if needed
    const transactionDate = typeof t.date === 'string' ? new Date(t.date) : t.date;
    return isWithinInterval(transactionDate, { start, end });
  });
};

export const getTransactionsByCategory = (transactions: Transaction[] | undefined): CategoryData[] => {
  if (!transactions || !Array.isArray(transactions)) {
    return [];
  }
  
  const categoryMap: Record<string, { receita: number; despesa: number }> = {};
  
  transactions.forEach(t => {
    // Ignorar transferências e alocações
    if (t.type === TransactionType.TRANSFER || t.type === TransactionType.ALLOCATION) {
      return;
    }
    
    const category = t.category || 'Sem categoria';
    if (!categoryMap[category]) {
      categoryMap[category] = { receita: 0, despesa: 0 };
    }
    
    // Mapear TransactionType para propriedades do objeto de dados (usado pelos gráficos)
    if (t.type === TransactionType.INCOME) {
      categoryMap[category].receita += t.amount || 0;
    } else if (t.type === TransactionType.EXPENSE) {
      categoryMap[category].despesa += t.amount || 0;
    }
  });

  return Object.entries(categoryMap).map(([name, amounts]) => ({
    name,
    receita: amounts.receita,
    despesa: amounts.despesa,
    total: amounts.receita - amounts.despesa,
  }));
};

// Calcular transações recorrentes para um mês específico
export const getRecurringTransactionsForMonth = (
  recurringTransactions: RecurringTransaction[],
  targetMonth: Date
): Transaction[] => {
  const monthStart = startOfMonth(targetMonth);
  const monthEnd = endOfMonth(targetMonth);
  monthEnd.setHours(23, 59, 59, 999);
  const projected: Transaction[] = [];
  
  recurringTransactions.forEach(recurring => {
    if (!recurring.isActive) return;
    
    // Verificar se a transação recorrente está ativa neste mês
    if (recurring.endDate) {
      const endDate = new Date(recurring.endDate);
      endDate.setHours(0, 0, 0, 0);
      // Se endDate está antes do início do mês, não incluir
      if (isBefore(endDate, monthStart)) return;
    }
    
    if (recurring.startDate) {
      const startDate = new Date(recurring.startDate);
      startDate.setHours(0, 0, 0, 0);
      // Se startDate está depois do fim do mês, não incluir
      if (isAfter(startDate, monthEnd)) return;
    }
    
    // Começar a partir do startDate (se disponível e dentro do período) ou nextDueDate
    let baseDate: Date;
    if (recurring.startDate) {
      const startDate = new Date(recurring.startDate);
      startDate.setHours(0, 0, 0, 0);
      const nextDue = new Date(recurring.nextDueDate);
      nextDue.setHours(0, 0, 0, 0);
      // Usar a data mais antiga entre startDate e nextDueDate
      baseDate = isBefore(startDate, nextDue) ? startDate : nextDue;
    } else {
      baseDate = new Date(recurring.nextDueDate);
      baseDate.setHours(0, 0, 0, 0);
    }
    
    let currentDate = new Date(baseDate);
    
    // Avançar até chegar no mês alvo
    while (isBefore(currentDate, monthStart)) {
      switch (recurring.frequency) {
        case 'daily':
          currentDate = addDays(currentDate, 1);
          break;
        case 'weekly':
          currentDate = addWeeks(currentDate, 1);
          break;
        case 'biweekly':
          currentDate = addWeeks(currentDate, 2);
          break;
        case 'monthly':
          currentDate = addMonths(currentDate, 1);
          break;
        case 'yearly':
          currentDate = addYears(currentDate, 1);
          break;
      }
      
      // Proteção contra loop infinito
      if (isAfter(currentDate, addMonths(monthEnd, 2))) break;
    }
    
    // Adicionar todas as ocorrências dentro do mês
    let iterations = 0;
    const maxIterations = 31; // Máximo de ocorrências por mês (diária)
    
    while ((isBefore(currentDate, monthEnd) || isSameDay(currentDate, monthEnd)) && iterations < maxIterations) {
      // Verificar se está dentro do período válido da recorrente
      if (recurring.startDate) {
        const startDate = new Date(recurring.startDate);
        startDate.setHours(0, 0, 0, 0);
        if (isBefore(currentDate, startDate)) {
          // Pular para startDate
          currentDate = new Date(startDate);
          currentDate.setHours(0, 0, 0, 0);
          // Se startDate está depois do mês, parar
          if (isAfter(currentDate, monthEnd)) break;
          continue;
        }
      }
      
      if (recurring.endDate) {
        const endDate = new Date(recurring.endDate);
        endDate.setHours(0, 0, 0, 0);
        if (isAfter(currentDate, endDate)) break;
      }
      
      // Verificar se a data está dentro do mês alvo
      if ((isAfter(currentDate, monthStart) || isSameDay(currentDate, monthStart)) && 
          (isBefore(currentDate, monthEnd) || isSameDay(currentDate, monthEnd))) {
        projected.push({
          id: `projected-${recurring.id}-${currentDate.getTime()}`,
          description: recurring.description,
          // The forecast strategy decides the amount of the occurrence (per business day: the days of its reference month)
          amount: projectedOccurrenceAmount(recurring, recurring.type === TransactionType.INCOME ? 'INCOME' : 'EXPENSE', currentDate, recurring.competenceOffsetMonths),
          type: recurring.type,
          category: recurring.category,
          date: new Date(currentDate),
          accountId: recurring.accountId,
          userId: recurring.userId,
        } as Transaction);
      }
      
      switch (recurring.frequency) {
        case 'daily':
          currentDate = addDays(currentDate, 1);
          break;
        case 'weekly':
          currentDate = addWeeks(currentDate, 1);
          break;
        case 'biweekly':
          currentDate = addWeeks(currentDate, 2);
          break;
        case 'monthly':
          currentDate = addMonths(currentDate, 1);
          break;
        case 'yearly':
          currentDate = addYears(currentDate, 1);
          break;
      }
      
      iterations++;
      
      // Se já passou do mês, parar
      if (isAfter(currentDate, monthEnd)) break;
    }
  });
  
  return projected;
};

export const getMonthlyComparison = (
  transactions: Transaction[], 
  months: number = 6, 
  baseMonth?: Date,
  recurringTransactions?: RecurringTransaction[],
  accounts?: Account[]
): MonthlyComparison[] => {
  const comparisons: MonthlyComparison[] = [];
  const base = baseMonth ? startOfMonth(baseMonth) : startOfMonth(new Date());
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Função auxiliar para filtrar transações de cartão de crédito e movimentações internas
  const filterCreditCardTransactions = (transactions: Transaction[]): Transaction[] => {
    if (!accounts || accounts.length === 0) return transactions;
    
    return transactions.filter(transaction => {
      // Excluir transferências e alocações (movimentações internas)
      if (transaction.type === TransactionType.TRANSFER || transaction.type === TransactionType.ALLOCATION) {
        return false;
      }
      
      if (!transaction.accountId) return true; // Transações sem conta contam
      
      const account = accounts.find(a => a.id === transaction.accountId);
      const isCreditCard = account?.type === AccountType.CREDIT;
      
      // Se for conta de cartão de crédito, ignoramos no cálculo de lucro/prejuízo mensal
      // O custo real será computado quando houver a saída de caixa da conta bancária para pagar a fatura
      if (isCreditCard) {
        return false;
      }
      
      return true; // Inclui tudo mais
    });
  };

  for (let i = months - 1; i >= 0; i--) {
    const monthDate = subMonths(base, i);
    const monthEnd = endOfMonth(monthDate);
    const isPastMonth = isBefore(monthEnd, today);
    
    const monthTransactions = getTransactionsByMonth(transactions, monthDate);
    
    // Para meses passados: usar apenas transações liquidadas (já pagas/recebidas)
    // Para meses futuros: incluir todas as transações + recorrências projetadas
    let allMonthTransactions: Transaction[];
    
    if (isPastMonth) {
      // Mês passado: apenas liquidadas
      allMonthTransactions = getLiquidatedTransactions(monthTransactions);
    } else {
      // Mês atual ou futuro: incluir todas + recorrências projetadas
      // Mas evitar duplicar transações que já foram processadas
      allMonthTransactions = [...monthTransactions];
      if (recurringTransactions && recurringTransactions.length > 0) {
        const projectedRecurring = getRecurringTransactionsForMonth(recurringTransactions, monthDate);
        // Filtrar recorrências projetadas que já foram processadas (existem como transação normal)
        // Criar um conjunto de IDs de recorrências que já foram processadas neste mês
        const processedRecurringIds = new Set(
          monthTransactions
            .filter(t => t.recurringTransactionId)
            .map(t => t.recurringTransactionId!)
        );
        const newProjectedRecurring = projectedRecurring.filter(projected => {
          // As transações projetadas têm ID no formato: `projected-${recurring.id}-${timestamp}`
          // Extrair o ID da recorrência do ID da transação projetada
          const projectedId = projected.id || '';
          const recurringIdMatch = projectedId.match(/^projected-(.+?)-/);
          if (recurringIdMatch) {
            const recurringId = recurringIdMatch[1];
            // Se já existe uma transação processada para esta recorrência neste mês, não incluir
            if (processedRecurringIds.has(recurringId)) {
              return false;
            }
          }
          return true;
        });
        allMonthTransactions = [...monthTransactions, ...newProjectedRecurring];
      }
    }
    
    // Filtrar transações de cartão de crédito
    allMonthTransactions = filterCreditCardTransactions(allMonthTransactions);
    
    comparisons.push({
      month: monthDate.toLocaleString('pt-BR', { month: 'short', year: 'numeric' }),
      receita: getTotalIncome(allMonthTransactions),
      despesa: getTotalExpense(allMonthTransactions),
      saldo: getBalance(allMonthTransactions),
    });
  }

  return comparisons;
};

// Calcular evolução do saldo acumulado ao longo dos meses
export interface BalanceEvolution {
  month: string;
  saldo: number;
  saldoAcumulado: number;
}

export const getBalanceEvolution = (
  transactions: Transaction[],
  months: number = 12,
  baseMonth?: Date,
  recurringTransactions?: RecurringTransaction[],
  initialBalance: number = 0,
  accounts?: Account[]
): BalanceEvolution[] => {
  const evolution: BalanceEvolution[] = [];
  // Começar do mês atual (ou baseMonth se fornecido)
  const currentMonth = baseMonth ? startOfMonth(baseMonth) : startOfMonth(new Date());
  let accumulatedBalance = initialBalance;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Função auxiliar para filtrar transações de cartão de crédito e movimentações internas
  const filterCreditCardTransactions = (transactions: Transaction[]): Transaction[] => {
    if (!accounts || accounts.length === 0) return transactions;
    
    return transactions.filter(transaction => {
      // Excluir transferências e alocações (movimentações internas)
      if (transaction.type === TransactionType.TRANSFER || transaction.type === TransactionType.ALLOCATION) {
        return false;
      }
      
      if (!transaction.accountId) return true; // Transações sem conta contam
      
      const account = accounts.find(a => a.id === transaction.accountId);
      const isCreditCard = account?.type === AccountType.CREDIT;
      
      // Se for conta de cartão de crédito, ignoramos no cálculo de lucro/prejuízo mensal
      // O custo real será computado quando houver a saída de caixa da conta bancária para pagar a fatura
      if (isCreditCard) {
        return false;
      }
      
      return true; // Inclui tudo mais
    });
  };

  // Calcular os próximos 12 meses a partir do mês atual
  for (let i = 0; i < months; i++) {
    const monthDate = addMonths(currentMonth, i);
    const monthEnd = endOfMonth(monthDate);
    const isPastMonth = isBefore(monthEnd, today);
    const isCurrentMonth = monthDate.getMonth() === today.getMonth() && 
                           monthDate.getFullYear() === today.getFullYear();
    
    const monthTransactions = getTransactionsByMonth(transactions, monthDate);
    
    // Para meses passados: usar apenas transações liquidadas (já pagas/recebidas)
    // Para meses futuros: incluir todas as transações + recorrências projetadas
    let allMonthTransactions: Transaction[];
    
    if (isPastMonth) {
      // Mês passado: apenas liquidadas
      allMonthTransactions = getLiquidatedTransactions(monthTransactions);
    } else {
      // Mês atual ou futuro: incluir todas + recorrências projetadas
      // Mas evitar duplicar transações que já foram processadas
      allMonthTransactions = [...monthTransactions];
      if (recurringTransactions && recurringTransactions.length > 0) {
        const projectedRecurring = getRecurringTransactionsForMonth(recurringTransactions, monthDate);
        // Filtrar recorrências projetadas que já foram processadas (existem como transação normal)
        // Criar um conjunto de IDs de recorrências que já foram processadas neste mês
        const processedRecurringIds = new Set(
          monthTransactions
            .filter(t => t.recurringTransactionId)
            .map(t => t.recurringTransactionId!)
        );
        const newProjectedRecurring = projectedRecurring.filter(projected => {
          // As transações projetadas têm ID no formato: `projected-${recurring.id}-${timestamp}`
          // Extrair o ID da recorrência do ID da transação projetada
          const projectedId = projected.id || '';
          const recurringIdMatch = projectedId.match(/^projected-(.+?)-/);
          if (recurringIdMatch) {
            const recurringId = recurringIdMatch[1];
            // Se já existe uma transação processada para esta recorrência neste mês, não incluir
            if (processedRecurringIds.has(recurringId)) {
              return false;
            }
          }
          return true;
        });
        allMonthTransactions = [...monthTransactions, ...newProjectedRecurring];
      }
    }
    
    // Filtrar transações de cartão de crédito
    allMonthTransactions = filterCreditCardTransactions(allMonthTransactions);
    
    // Calcular receitas e despesas do mês
    const monthIncome = getTotalIncome(allMonthTransactions);
    const monthExpense = getTotalExpense(allMonthTransactions);
    const monthBalance = monthIncome - monthExpense;
    
    // Para o mês atual: o initialBalance já inclui todas as transações pagas do mês atual
    // Então não devemos adicionar/subtrair as transações liquidadas novamente
    // Apenas adicionar transações pendentes e recorrências projetadas
    if (isCurrentMonth && i === 0) {
      // Separar transações liquidadas (já refletidas no saldo) das pendentes
      // const liquidatedCurrentMonth = getLiquidatedTransactions(monthTransactions); // Not currently used
      const pendingCurrentMonth = monthTransactions.filter(t => t.paid === false);
      
      // Apenas processar transações pendentes (não liquidadas)
      const pendingFiltered = filterCreditCardTransactions(pendingCurrentMonth);
      const pendingIncome = getTotalIncome(pendingFiltered);
      const pendingExpense = getTotalExpense(pendingFiltered);
      
      // Adicionar recorrências projetadas que ainda não foram processadas
      let projectedIncome = 0;
      let projectedExpense = 0;
      if (recurringTransactions && recurringTransactions.length > 0) {
        const projectedRecurring = getRecurringTransactionsForMonth(recurringTransactions, monthDate);
        const processedRecurringIds = new Set(
          monthTransactions
            .filter(t => t.recurringTransactionId)
            .map(t => t.recurringTransactionId!)
        );
        const newProjectedRecurring = projectedRecurring.filter(projected => {
          const projectedId = projected.id || '';
          const recurringIdMatch = projectedId.match(/^projected-(.+?)-/);
          if (recurringIdMatch) {
            const recurringId = recurringIdMatch[1];
            if (processedRecurringIds.has(recurringId)) {
              return false;
            }
          }
          return true;
        });
        const projectedFiltered = filterCreditCardTransactions(newProjectedRecurring);
        projectedIncome = getTotalIncome(projectedFiltered);
        projectedExpense = getTotalExpense(projectedFiltered);
      }
      
      // Saldo acumulado do mês atual = saldo atual (já tem transações liquidadas) 
      // + apenas transações pendentes + recorrências projetadas
      accumulatedBalance = accumulatedBalance + pendingIncome - pendingExpense + projectedIncome - projectedExpense;
    } else {
      // Para meses futuros: adicionar receitas e subtrair despesas normalmente
      accumulatedBalance = accumulatedBalance + monthIncome - monthExpense;
    }
    
    evolution.push({
      month: monthDate.toLocaleString('pt-BR', { month: 'short', year: 'numeric' }),
      saldo: monthBalance,
      saldoAcumulado: accumulatedBalance,
    });
  }

  return evolution;
};

// Separar transações liquidadas (pagos/recebidos) de pendentes
export const getLiquidatedTransactions = (transactions: Transaction[] | undefined): Transaction[] => {
  if (!transactions || !Array.isArray(transactions)) {
    return [];
  }
  // Retorna apenas transações marcadas como pagas/recebidas
  // Para retrocompatibilidade: se paid não existe, assume como pago (comportamento antigo)
  return transactions.filter(t => t && t.paid !== false); // undefined ou true = pago
};

// Transações pendentes (não pagas/recebidas)
export const getPendingTransactions = (transactions: Transaction[] | undefined): Transaction[] => {
  if (!transactions || !Array.isArray(transactions)) {
    return [];
  }
  return transactions.filter(t => t.paid === false);
};

// Transações futuras (por data, independente de pagamento)
export const getFutureTransactions = (transactions: Transaction[] | undefined): Transaction[] => {
  if (!transactions || !Array.isArray(transactions)) {
    return [];
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  return transactions.filter(t => {
    const transactionDate = new Date(t.date);
    transactionDate.setHours(0, 0, 0, 0);
    return isAfter(transactionDate, today);
  });
};

/**
 * REGRA DE NEGÓCIO CRÍTICA:
 * Esta função calcula APENAS projeções visuais no frontend.
 * Essas transações NÃO existem no banco de dados e NÃO afetam:
 * - Saldos de contas
 * - Limites de cartão de crédito
 * - Cálculos financeiros reais
 * 
 * Transações reais são criadas APENAS pelo cronjob no dia do vencimento.
 * 
 * Calcular transações previstas a partir de recorrentes (apenas projeção visual)
 */
export const getProjectedRecurringTransactions = (
  recurringTransactions: RecurringTransaction[],
  daysAhead: number = 30
): Transaction[] => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + daysAhead);
  
  const projected: Transaction[] = [];
  
  recurringTransactions.forEach(recurring => {
    if (!recurring.isActive) return;
    if (recurring.endDate && isAfter(today, recurring.endDate)) return;
    
    let currentDate = new Date(recurring.nextDueDate);
    currentDate.setHours(0, 0, 0, 0);
    
    // Se a próxima data já passou, calcular a próxima ocorrência
    if (isBefore(currentDate, today)) {
      switch (recurring.frequency) {
        case 'daily':
          while (isBefore(currentDate, today)) {
            currentDate = addDays(currentDate, 1);
          }
          break;
        case 'weekly':
          while (isBefore(currentDate, today)) {
            currentDate = addWeeks(currentDate, 1);
          }
          break;
        case 'biweekly':
          while (isBefore(currentDate, today)) {
            currentDate = addWeeks(currentDate, 2);
          }
          break;
        case 'monthly':
          while (isBefore(currentDate, today)) {
            currentDate = addMonths(currentDate, 1);
          }
          break;
        case 'yearly':
          while (isBefore(currentDate, today)) {
            currentDate = addYears(currentDate, 1);
          }
          break;
      }
    }
    
    // Adicionar todas as ocorrências dentro do período (máximo 365 para evitar loops infinitos)
    let iterations = 0;
    const maxIterations = 365;
    
    while ((isBefore(currentDate, endDate) || isSameDay(currentDate, endDate)) && iterations < maxIterations) {
      if (!recurring.endDate || isBefore(currentDate, recurring.endDate) || isSameDay(currentDate, recurring.endDate)) {
        projected.push({
          id: `projected-${recurring.id}-${currentDate.getTime()}`,
          description: recurring.description,
          // The forecast strategy decides the amount of the occurrence (per business day: the days of its reference month)
          amount: projectedOccurrenceAmount(recurring, recurring.type === TransactionType.INCOME ? 'INCOME' : 'EXPENSE', currentDate, recurring.competenceOffsetMonths),
          type: recurring.type,
          category: recurring.category,
          date: new Date(currentDate),
          accountId: recurring.accountId,
          userId: recurring.userId,
        } as Transaction);
      }
      
      switch (recurring.frequency) {
        case 'daily':
          currentDate = addDays(currentDate, 1);
          break;
        case 'weekly':
          currentDate = addWeeks(currentDate, 1);
          break;
        case 'biweekly':
          currentDate = addWeeks(currentDate, 2);
          break;
        case 'monthly':
          currentDate = addMonths(currentDate, 1);
          break;
        case 'yearly':
          currentDate = addYears(currentDate, 1);
          break;
      }
      
      iterations++;
    }
  });
  
  return projected;
};

