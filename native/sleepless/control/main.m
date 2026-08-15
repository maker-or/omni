#import <Foundation/Foundation.h>
#import <Security/Authorization.h>
#import <Security/AuthorizationTags.h>
#import <sys/stat.h>
#import <unistd.h>

static NSString *const kLabel = @"com.maker-or.omni.sleeplessd";
static NSString *const kInstalledDaemon = @"/Library/PrivilegedHelperTools/com.maker-or.omni.sleeplessd";
static NSString *const kInstalledPlist = @"/Library/LaunchDaemons/com.maker-or.omni.sleeplessd.plist";
static NSString *const kInstalledConfig = @"/Library/PrivilegedHelperTools/com.maker-or.omni.sleeplessd.plist";
static const NSInteger kInstallerVersion = 1;

static void PrintResult(NSString *status, NSError *error) {
    NSMutableDictionary *body = [@{ @"status": status } mutableCopy];
    if (error) body[@"error"] = error.localizedDescription;
    NSData *data = [NSJSONSerialization dataWithJSONObject:body options:0 error:nil];
    fwrite(data.bytes, 1, data.length, stdout);
    fputc('\n', stdout);
}

static NSDictionary *RunTask(NSString *executable, NSArray<NSString *> *arguments) {
    NSTask *task = [[NSTask alloc] init];
    NSPipe *pipe = [NSPipe pipe];
    task.executableURL = [NSURL fileURLWithPath:executable];
    task.arguments = arguments;
    task.standardOutput = pipe;
    task.standardError = pipe;
    NSError *error = nil;
    if (![task launchAndReturnError:&error]) {
        return @{ @"status": @(-1), @"output": error.localizedDescription ?: @"Unable to launch process." };
    }
    [task waitUntilExit];
    NSData *data = [pipe.fileHandleForReading readDataToEndOfFile];
    NSString *output = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] ?: @"";
    return @{ @"status": @(task.terminationStatus), @"output": output };
}

static NSString *AppBundleRoot(void) {
    NSString *path = NSProcessInfo.processInfo.arguments.firstObject.stringByResolvingSymlinksInPath;
    NSRange range = [path rangeOfString:@".app/Contents/"];
    if (range.location == NSNotFound) return nil;
    return [[path substringToIndex:range.location] stringByAppendingString:@".app"];
}

static NSString *ExpectedClientPath(NSString *root) {
    NSDictionary *info = [NSDictionary dictionaryWithContentsOfFile:
        [root stringByAppendingPathComponent:@"Contents/Info.plist"]];
    NSString *executable = [info[@"CFBundleExecutable"] isKindOfClass:NSString.class]
        ? info[@"CFBundleExecutable"] : nil;
    if (!executable.length) return nil;
    return [[root stringByAppendingPathComponent:@"Contents/MacOS"]
        stringByAppendingPathComponent:executable].stringByResolvingSymlinksInPath;
}

static NSString *BundledDaemonPath(NSString *root) {
    return [root stringByAppendingPathComponent:@"Contents/Resources/sleepless/omni-sleeplessd"];
}

static BOOL LegacyServiceMatchesApp(NSString *root) {
    NSFileManager *files = NSFileManager.defaultManager;
    if (![files isExecutableFileAtPath:kInstalledDaemon] || ![files fileExistsAtPath:kInstalledPlist])
        return NO;
    NSDictionary *config = [NSDictionary dictionaryWithContentsOfFile:kInstalledConfig];
    NSString *configuredRoot = [config[@"appRoot"] isKindOfClass:NSString.class]
        ? [config[@"appRoot"] stringByResolvingSymlinksInPath] : nil;
    if (![configuredRoot isEqualToString:root.stringByResolvingSymlinksInPath]) return NO;
    return [config[@"installerVersion"] integerValue] == kInstallerVersion &&
           [files isExecutableFileAtPath:BundledDaemonPath(root)];
}

static BOOL ReplaceFile(NSData *data, NSString *destination, mode_t mode, NSError **error) {
    NSString *temporary = [destination stringByAppendingString:@".new"];
    [NSFileManager.defaultManager removeItemAtPath:temporary error:nil];
    if (![data writeToFile:temporary options:NSDataWritingAtomic error:error]) return NO;
    if (chmod(temporary.fileSystemRepresentation, mode) != 0 ||
        chown(temporary.fileSystemRepresentation, 0, 0) != 0) {
        if (error) *error = [NSError errorWithDomain:NSPOSIXErrorDomain code:errno userInfo:nil];
        return NO;
    }
    if (rename(temporary.fileSystemRepresentation, destination.fileSystemRepresentation) != 0) {
        if (error) *error = [NSError errorWithDomain:NSPOSIXErrorDomain code:errno userInfo:nil];
        return NO;
    }
    return YES;
}

static NSError *InstallAsRoot(NSString *root) {
    if (geteuid() != 0) {
        return [NSError errorWithDomain:@"com.maker-or.omni.sleeplessctl" code:1
            userInfo:@{NSLocalizedDescriptionKey: @"The Sleepless installer did not receive administrator access."}];
    }
    root = root.stringByResolvingSymlinksInPath;
    NSString *clientPath = ExpectedClientPath(root);
    NSData *daemon = [NSData dataWithContentsOfFile:BundledDaemonPath(root)];
    if (!clientPath.length || !daemon.length) {
        return [NSError errorWithDomain:@"com.maker-or.omni.sleeplessctl" code:2
            userInfo:@{NSLocalizedDescriptionKey: @"The app bundle is missing its Sleepless components."}];
    }

    NSError *error = nil;
    if (![NSFileManager.defaultManager createDirectoryAtPath:kInstalledDaemon.stringByDeletingLastPathComponent
                                 withIntermediateDirectories:YES attributes:nil error:&error]) return error;
    if (!ReplaceFile(daemon, kInstalledDaemon, 0755, &error)) return error;

    NSDictionary *config = @{ @"appRoot": root, @"installerVersion": @(kInstallerVersion) };
    NSData *configData = [NSPropertyListSerialization dataWithPropertyList:config
        format:NSPropertyListXMLFormat_v1_0 options:0 error:&error];
    if (!configData || !ReplaceFile(configData, kInstalledConfig, 0644, &error)) return error;

    NSDictionary *plist = @{
        @"Label": kLabel,
        @"ProgramArguments": @[kInstalledDaemon],
        @"RunAtLoad": @YES,
        @"KeepAlive": @YES,
        @"ProcessType": @"Adaptive",
        @"ThrottleInterval": @5,
    };
    NSData *plistData = [NSPropertyListSerialization dataWithPropertyList:plist
        format:NSPropertyListXMLFormat_v1_0 options:0 error:&error];
    if (!plistData || !ReplaceFile(plistData, kInstalledPlist, 0644, &error)) return error;

    RunTask(@"/bin/launchctl", @[@"bootout", @"system/com.maker-or.omni.sleeplessd"]);
    NSDictionary *result = RunTask(@"/bin/launchctl", @[@"bootstrap", @"system", kInstalledPlist]);
    if ([result[@"status"] intValue] != 0) {
        NSString *message = [result[@"output"] length] ? result[@"output"] : @"launchctl bootstrap failed.";
        return [NSError errorWithDomain:@"com.maker-or.omni.sleeplessctl" code:3
            userInfo:@{NSLocalizedDescriptionKey: message}];
    }
    RunTask(@"/bin/launchctl", @[@"enable", @"system/com.maker-or.omni.sleeplessd"]);
    return nil;
}

static NSError *RunPrivilegedInstall(NSString *root) {
    AuthorizationRef authorization = NULL;
    OSStatus status = AuthorizationCreate(NULL, kAuthorizationEmptyEnvironment,
                                          kAuthorizationFlagDefaults, &authorization);
    if (status != errAuthorizationSuccess) {
        return [NSError errorWithDomain:NSOSStatusErrorDomain code:status userInfo:nil];
    }
    AuthorizationItem item = { kAuthorizationRightExecute, 0, NULL, 0 };
    AuthorizationRights rights = { 1, &item };
    AuthorizationFlags flags = kAuthorizationFlagInteractionAllowed |
                               kAuthorizationFlagExtendRights |
                               kAuthorizationFlagPreAuthorize;
    status = AuthorizationCopyRights(authorization, &rights, kAuthorizationEmptyEnvironment,
                                     flags, NULL);
    if (status != errAuthorizationSuccess) {
        AuthorizationFree(authorization, kAuthorizationFlagDefaults);
        return [NSError errorWithDomain:NSOSStatusErrorDomain code:status userInfo:nil];
    }

    char *arguments[] = { "install-root", (char *)root.fileSystemRepresentation, NULL };
    FILE *pipe = NULL;
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    status = AuthorizationExecuteWithPrivileges(authorization,
        NSProcessInfo.processInfo.arguments.firstObject.fileSystemRepresentation,
        kAuthorizationFlagDefaults, arguments, &pipe);
#pragma clang diagnostic pop
    if (status != errAuthorizationSuccess) {
        AuthorizationFree(authorization, kAuthorizationFlagDefaults);
        return [NSError errorWithDomain:NSOSStatusErrorDomain code:status userInfo:nil];
    }

    NSData *output = pipe ? [[NSFileHandle alloc] initWithFileDescriptor:fileno(pipe)
        closeOnDealloc:YES].readDataToEndOfFile : nil;
    AuthorizationFree(authorization, kAuthorizationFlagDefaults);
    NSDictionary *result = output.length
        ? [NSJSONSerialization JSONObjectWithData:output options:0 error:nil] : nil;
    if ([result[@"status"] isEqualToString:@"enabled"]) return nil;
    NSString *message = [result[@"error"] isKindOfClass:NSString.class]
        ? result[@"error"] : @"The privileged Sleepless installer failed.";
    return [NSError errorWithDomain:@"com.maker-or.omni.sleeplessctl" code:4
        userInfo:@{NSLocalizedDescriptionKey: message}];
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSString *command = argc > 1 ? [NSString stringWithUTF8String:argv[1]] : @"status";
        if ([command isEqualToString:@"install-root"]) {
            NSString *root = argc > 2 ? [NSString stringWithUTF8String:argv[2]] : @"";
            NSError *error = InstallAsRoot(root);
            PrintResult(error ? @"not-registered" : @"enabled", error);
            return error ? 1 : 0;
        }

        NSString *root = AppBundleRoot();
        if (!root.length) {
            PrintResult(@"not-found", [NSError errorWithDomain:@"com.maker-or.omni.sleeplessctl"
                code:5 userInfo:@{NSLocalizedDescriptionKey: @"Sleepless must run from inside the app bundle."}]);
            return 1;
        }
        if ([command isEqualToString:@"status"] || [command isEqualToString:@"open-settings"]) {
            PrintResult(LegacyServiceMatchesApp(root) ? @"enabled" : @"not-registered", nil);
            return 0;
        }
        if ([command isEqualToString:@"register"]) {
            NSError *error = LegacyServiceMatchesApp(root) ? nil : RunPrivilegedInstall(root);
            PrintResult(error ? @"not-registered" : @"enabled", error);
            return error ? 1 : 0;
        }

        PrintResult(@"error", [NSError errorWithDomain:@"com.maker-or.omni.sleeplessctl" code:6
            userInfo:@{NSLocalizedDescriptionKey:
                [NSString stringWithFormat:@"Unknown command: %@", command]}]);
        return 1;
    }
}
