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
    // if (settings.hasOwnProperty("autoRetirement")) {
    //     settings.autoretirementCtrl.savingsPercent = settings.autoRetirement["savingsPercent"]
    // }
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

    console.log(Helpers.GetRetirementInfo());
    console.log(Helpers.GetCurrentEmployeeStat());
    console.log(Helpers.GetHostingPerformance());
    // console.log(Helpers.GetRackPerformance());

    let Change = Math.round(settings.balance - OldBalance);
    if (Change > 0) {
        let addToBalance = Math.round((Change * RetirementSavingsPercent) / 100);
        let total = calculateActualSavings(addToBalance);

        e.safeBuy(() => {
            settings.ceo.retirementFund.balance += total;
            settings.ceo.retirementFund.history.push({
                day: e.daysPlayed,
                year: Helpers.CalculateYears(e.daysPlayed),
                amount: total
            });
        }, addToBalance, Helpers.GetLocalized("transaction_retirement_fund"), !0);

        if (NotificationsEnabled) {
            Helpers.ShowNotification("Day " + (e.daysPlayed - 1) + ". Savings increased by $"
                + total.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","), "#000000", 24, false);
        }
        OldBalance = settings.balance;
    }
};

