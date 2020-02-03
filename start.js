let _modPath;

const e = GetRootScope();

let OldBalance = 0;
let RetirementSavingsPercent = 10;
let NotificationsEnabled = true;

exports.initialize = (modPath) => {
    _modPath = modPath;

    // Add new menu item
    Modding.setMenuItem({
        name: 'autoretirement',
        tooltip: "Auto Retirement Mod",
        tooltipPosition: 'top',
        faIcon: 'fa-wheelchair',
        badgeCount: 0,
    });

    // Define custom views
    exports.views = [{
        name: 'autoretirement',
        viewPath: _modPath + 'view.html',
        controller: function ($rootScope, $scope) {
            if (!$rootScope.settings.hasOwnProperty("autoRetirement")) {
                $rootScope.settings.autoRetirement = {
                    notificationsEnabled: true,
                    savingsPercent: 10
                };
            }
            $scope.$watch("autoretirementCtrl.savingsPercent", newValue => {
                RetirementSavingsPercent = newValue;
                $rootScope.settings.autoRetirement["savingsPercent"] = newValue;
            });
            this.savingsPercent = RetirementSavingsPercent;
            this.notificationsEnabled = NotificationsEnabled;
            this.toggleNotifications = (() => {
                NotificationsEnabled = !NotificationsEnabled;
                $rootScope.settings.autoRetirement["notificationEnabled"] = NotificationsEnabled;
                this.notificationsEnabled = NotificationsEnabled;
            });
        }
    }]
};

exports.onLoadGame = settings => {
    OldBalance = settings.balance;
    RetirementSavingsPercent = settings.autoRetirement ? settings.autoRetirement.savingsPercent : 10;
    NotificationsEnabled = settings.autoRetirement ? settings.autoRetirement.notificationsEnabled : true;
};
exports.onNewHour = settings => {

    //region AutoOutSource
    function runGameLogicForCreatingNewOutsourcingTask(anyIdleOutsourcingExecutive, componentName) {
        function getRequirementsMap(requirements) {
            let requirementsMap = {};
            for (const requirementItem of requirements) {
                if (requirementItem != null) {
                    requirementsMap[requirementItem.componentName] = requirementItem.amount;
                }
            }
            return requirementsMap
        }

        //TODO: 100 to GUI changeable variable
        let requirementsArray = [{componentName: componentName, amount: 100}];
        let requirementsMap = getRequirementsMap(requirementsArray);
        let task = {
            id: chance.guid(),
            requirements: requirementsMap,
            deadline: {
                total: 24 * Math.max(Math.round(Helpers.GetOutsourcingBaseDays(requirementsMap) / 4), 1),
                completed: 0
            },
            timestamp: Helpers.GetCurrentTimestamp(),
            number: Helpers.GetNextOutsourcingTaskNumber(),
            offers: [],
            won: null,
            delivered: !1,
            hoursLeft: 24,
            maxOffers: Helpers.GetMaxOutsourcingOffersByEmployeeLevel(anyIdleOutsourcingExecutive.level)
        };
        task.startPrice = Math.max(Math.round(2 * Helpers.GetMarketPriceByTask(task)), 1e3);
        task.fee = Math.max(30 * _.sum(requirementsArray.map(e => e.amount)), 1e3);

        e.settings.outsourcingTasks.push(task);
        e.addTransaction(Helpers.GetLocalized("transaction_outsourcing_fee"), -task.fee, !0);
        anyIdleOutsourcingExecutive.outsourcingTaskId = task.id;
    }

    function submitNewTask() {
        function getPlanProgress() {
            let componentsPlanDoneByComponentArray = [];
            Components.forEach(component => {
                let productionPlanComponentValue = settings.productionPlans[0].production[component.name];
                let inventoryComponentValue = settings.inventory[component.name];
                if (!productionPlanComponentValue || productionPlanComponentValue == 0) {
                    return;
                }
                if (productionPlanComponentValue &&
                    (!inventoryComponentValue || inventoryComponentValue == 0)) {
                    componentsPlanDoneByComponentArray.push({componentName: component.name, done: 0});
                    return;
                }
                let alreadyOrderedForOutSourcingAmount = settings.outsourcingTasks
                    .flatMap(task => task.requirements)
                    .map(requirements => requirements[component.name])
                    .filter(requirements => requirements)
                    .reduce((previousValue, currentValue) => previousValue + currentValue, 0);

                let donePercent = Math.round(((inventoryComponentValue + alreadyOrderedForOutSourcingAmount)
                    / productionPlanComponentValue) * 100);
                console.log({componentName: component.name, done: donePercent});
                componentsPlanDoneByComponentArray.push({componentName: component.name, done: donePercent});
            });

            return componentsPlanDoneByComponentArray;
        }

        let anyIdleOutsourcingExecutive = Helpers.GetAllEmployees()
            .filter(employee => employee.employeeTypeName == Enums.EmployeeTypeNames.OutsourcingExecutive)
            .find(employee => employee.outsourcingTaskId == null);

        if (!anyIdleOutsourcingExecutive) return;
        if (!settings.productionPlans[0]) return;
        let componentsPlanDoneByComponentArray = getPlanProgress();
        let componentWithLowestPlanDone = componentsPlanDoneByComponentArray
            .reduce((prev, curr) => prev.done < curr.done ? prev : curr);

        if (anyIdleOutsourcingExecutive) {
            runGameLogicForCreatingNewOutsourcingTask(anyIdleOutsourcingExecutive, componentWithLowestPlanDone.componentName);
        }
    }

    submitNewTask();
    //endregion
};

exports.onNewDay = settings => {
    function calculateActualSavings(addToBalance) {
        let t = settings.products.find(e => e.investor);
        let investorOwn = t ? 100 - t.ownedPercentage : 0;
        let investorCut = investorOwn > 0 ? Math.round(investorOwn * addToBalance / 100) : 0;
        let taxPercentage = Helpers.CalculateTax(addToBalance - investorCut);
        let taxes = (addToBalance - investorCut) * (taxPercentage / 100);
        return Math.round(addToBalance - investorCut - taxes);
    }

    function runGameLogicForIncreasingRetirementFunds(addToBalance) {
        let total = calculateActualSavings(addToBalance);

        e.safeBuy(() => {
            settings.ceo.retirementFund.balance += total;
            settings.ceo.retirementFund.history.push({
                day: e.daysPlayed,
                year: Helpers.CalculateYears(e.daysPlayed),
                amount: total
            });
        }, addToBalance, Helpers.GetLocalized("transaction_retirement_fund"), !0);
        return total;
    }

    let Change = settings.products.map(product => {
        let lastRegisteredUsersInfo = product.stats.registeredUsers[product.stats.registeredUsers.length - 1];
        let change = lastRegisteredUsersInfo.income - lastRegisteredUsersInfo.expenses;
        console.debug("Last day project " + product.name + " made " + numeral(change).format(Configuration.CURRENCY_FORMAT));
        return change;
    }).reduce((previousValue, currentValue) => previousValue + currentValue);

    if (Change > 0) {
        let addToBalance = Math.round((Change * RetirementSavingsPercent) / 100);
        let total = runGameLogicForIncreasingRetirementFunds(addToBalance);

        if (NotificationsEnabled) {
            Helpers.ShowNotification("Day " + (e.daysPlayed - 1) + ". Savings increased by "
                + numeral(total).format(Configuration.CURRENCY_FORMAT), "#000000", 24, false);
        }
        OldBalance = settings.balance;
    }
};

