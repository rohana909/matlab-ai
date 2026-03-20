% Copyright 2025 The MathWorks, Inc.

function result = vsCodeGetAppsGalleryData()
    % Get installed/licensed toolboxes
    v = ver();
    result.toolboxNames    = {v.Name};
    result.toolboxVersions = {v.Version};

    tbxRoot = fullfile(matlabroot, 'toolbox');

    appNames = {}; appStems = {}; appPaths = {}; appFolders = {};

    % --- Strategy 1: top-level .mlapp files in <tbx>/<tbx>/ not in +pkg dirs ---
    tbxDirs = dir(tbxRoot);
    tbxDirs = tbxDirs([tbxDirs.isdir] & ~startsWith({tbxDirs.name}, '.'));

    for i = 1:numel(tbxDirs)
        tbxName = tbxDirs(i).name;
        mainDir = fullfile(tbxRoot, tbxName, tbxName);
        if ~isfolder(mainDir), continue; end

        files = dir(fullfile(mainDir, '*.mlapp'));
        for j = 1:numel(files)
            % Skip files inside +package directories
            if contains(files(j).folder, [filesep '+'])
                continue
            end
            [~, stem] = fileparts(files(j).name);
            appNames{end+1}   = stem; %#ok<AGROW>
            appStems{end+1}   = stem; %#ok<AGROW>
            appPaths{end+1}   = fullfile(files(j).folder, files(j).name); %#ok<AGROW>
            appFolders{end+1} = tbxName; %#ok<AGROW>
        end
    end

    % --- Strategy 2: scan MATLAB path for dedicated app directories ---
    pathDirs = strsplit(path, pathsep);

    for k = 1:numel(pathDirs)
        d = pathDirs{k};
        if ~startsWith(d, tbxRoot), continue; end

        parts  = strsplit(d, filesep);
        tbxIdx = find(strcmp(parts, 'toolbox'), 1, 'last');
        if isempty(tbxIdx) || numel(parts) <= tbxIdx + 1, continue; end

        tbxName = parts{tbxIdx + 1};
        dirName = parts{end};

        % Skip the main toolbox functions dir (<tbx>/<tbx>/)
        if strcmpi(dirName, tbxName), continue; end

        % Heuristic A: directory name ends with 'app' or 'apps'
        isAppDir = endsWith(lower(dirName), 'app') || endsWith(lower(dirName), 'apps');

        % Heuristic B: directory name (lowercase) starts with some file stem
        % e.g. signalanalyzer/ contains signalAnalyzer.m → 'signalanalyzer'.startsWith('signalanalyzer')
        if ~isAppDir
            candidates = [dir(fullfile(d, '*.m')); dir(fullfile(d, '*.mlapp'))];
            for j = 1:numel(candidates)
                [~, stem] = fileparts(candidates(j).name);
                if numel(stem) >= 5 && startsWith(lower(dirName), lower(stem))
                    isAppDir = true;
                    break
                end
            end
        end

        if ~isAppDir, continue; end

        files = [dir(fullfile(d, '*.mlapp')); dir(fullfile(d, '*.m'))];
        for j = 1:numel(files)
            [~, stem] = fileparts(files(j).name);
            appNames{end+1}   = stem; %#ok<AGROW>
            appStems{end+1}   = stem; %#ok<AGROW>
            appPaths{end+1}   = fullfile(d, files(j).name); %#ok<AGROW>
            appFolders{end+1} = tbxName; %#ok<AGROW>
        end
    end

    % Deduplicate by stem (keep first occurrence)
    [~, ia]  = unique(lower(appStems));
    appNames   = appNames(ia);
    appStems   = appStems(ia);
    appPaths   = appPaths(ia);
    appFolders = appFolders(ia);

    n = numel(appNames);
    if n > 0
        result.builtinApps = struct('name', appNames, 'stem', appStems, ...
            'path', appPaths, 'toolboxFolder', appFolders);
    else
        result.builtinApps = struct('name', {}, 'stem', {}, ...
            'path', {}, 'toolboxFolder', {});
    end

    % User-installed custom apps
    try
        info = matlab.apputil.getInstalledAppInfo();
        if isempty(info)
            result.customApps = struct('id', {}, 'name', {}, 'location', {});
        else
            result.customApps = info;
        end
    catch
        result.customApps = struct('id', {}, 'name', {}, 'location', {});
    end
end
