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

    //region AutoUpgrade
    function runGameLogicForFeatureUpdate(requirements, featureInstance, levelAmount) {
        Helpers.ApplyRequirementsToInventory(requirements);
        settings.xp += 2 * Helpers.CalculateComponentProductionHours({requirements: requirements});
        featureInstance.quality.current += levelAmount;
        PlaySound(Sounds.place5);
        e.$broadcast(Enums.GameEvents.ProductChange);
        Helpers.RunBackgroundWorker(null, null, !0);
        setTimeout(() => {
            e.$broadcast(Enums.GameEvents.MilestoneTrigger)
        }, 500);
    }

    function upgrade(featureInstance, featureProperty, levelAmount) {
        let requirements = Helpers.GetInstanceMultiplier(featureInstance, Enums.FeatureProperties.Quality, levelAmount);
        let featuresProduct = settings.products.find(product => product.id == featureInstance.productId);
        let productsFrameworkName = featuresProduct.frameworkName;
        let maxFeatureLevel = Frameworks.find(framework => framework.name == productsFrameworkName).maxFeatureLevel;
        let upgradeReady = Helpers.ConvertRequirementsIntoStacks(requirements).every(e => e.isAvailableInInventory)
            && featureInstance.quality.current + levelAmount <= maxFeatureLevel;

        if (upgradeReady) {
            runGameLogicForFeatureUpdate(requirements, featureInstance, levelAmount);
        } else {
            console.debug("Can't update feature " + featureInstance.featureName + " of product " + featuresProduct.name);
        }
    }

    function getCategoryName(featureInstances) {
        return Features.find(featureConst => featureConst.name == featureInstances.featureName).categoryName;
    }

    settings.products.forEach(product => {
        let featureWithLowestLevelForProduct = settings.featureInstances
            .filter(featureInstance => getCategoryName(featureInstance) == Enums.FeatureCategories.Users)
            .filter(featureInstance => featureInstance.productId == product.id)
            .reduce((prev, curr) => prev.quality.current < curr.quality.current ? prev : curr);

        // TODO: 10 to GUI changeable variable
        upgrade(featureWithLowestLevelForProduct, Enums.FeatureProperties.Quality, 10);
    });
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

