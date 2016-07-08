function countNoun(cnt, nounSing, nounPlur)
{
    if (cnt == 1)
        return "1 " + nounSing;
    else if (nounPlur)
        return cnt + " " + nounPlur;
    else
        return cnt + " " + nounSing + "s";
}

$(document).ready(function() {
    $("[data-repo-name]").each(function()
    {
        var $el = $(this);
        var name = $el.data("repoName");

        var $repoLinkItem = $el.find(".repo-link-item");
        var $stars = $el.find(".stars");
        var $watchers = $el.find(".watchers");
        var $forks = $el.find(".forks");
        var $issues = $el.find(".issues");

        $.ajax({
            url: "https://github-api.vercas.com/repos/" + name,
            success: function(dat)
            {
                $repoLinkItem.append('<span class="badge last-update">Last update: ' + dat.updated_at.slice(0, 10) + '</span>');

                $stars.text(countNoun(dat.stargazers_count, 'stargazer'));
                $watchers.text(countNoun(dat.watchers_count, 'watcher'));
                $forks.text(countNoun(dat.forks_count, 'fork'));
                $issues.text(countNoun(dat.open_issues_count, 'issue'));
            },
            dataType: "json"
        });
    });
});
