#import <Foundation/Foundation.h>
#import <IOKit/IOKitLib.h>
#import <Security/Security.h>
#import <dispatch/dispatch.h>
#import <grp.h>
#import <libproc.h>
#import <sys/socket.h>
#import <sys/stat.h>
#import <sys/un.h>
#import <unistd.h>

static const char *kSocketPath = "/var/run/com.maker-or.omni.sleeplessd.sock";
static NSString *const kRecoveryPath = @"/var/db/com.maker-or.omni.sleeplessd-state.json";
static NSString *const kInstalledConfig = @"/Library/PrivilegedHelperTools/com.maker-or.omni.sleeplessd.plist";
static const NSTimeInterval kHeartbeatTimeout = 12.0;

@interface SleeplessLease : NSObject
@property(nonatomic) BOOL baselineSleepDisabled;
@property(nonatomic) NSDate *armedAt;
@property(nonatomic) NSDate *lastHeartbeat;
@property(nonatomic) NSInteger activeTasks;
@property(nonatomic) NSInteger batteryFloor;
@property(nonatomic) NSTimeInterval maxDuration;
@property(nonatomic) BOOL acOnly;
@property(nonatomic) NSUInteger generation;
@end
@implementation SleeplessLease
@end

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

static BOOL ReadClamshellState(void) {
    io_service_t service = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("IOPMrootDomain"));
    if (service == IO_OBJECT_NULL) return NO;
    CFTypeRef value = IORegistryEntryCreateCFProperty(service, CFSTR("AppleClamshellState"),
                                                       kCFAllocatorDefault, 0);
    IOObjectRelease(service);
    if (!value) return NO;
    BOOL closed = CFGetTypeID(value) == CFBooleanGetTypeID() && CFBooleanGetValue(value);
    CFRelease(value);
    return closed;
}

static NSDictionary *PowerSnapshot(void) {
    NSString *output = RunTask(@"/usr/bin/pmset", @[@"-g", @"batt"])[@"output"];
    BOOL onBattery = [output containsString:@"Battery Power"];
    NSRegularExpression *regex = [NSRegularExpression regularExpressionWithPattern:@"([0-9]+)%"
                                                                            options:0 error:nil];
    NSTextCheckingResult *match = [regex firstMatchInString:output options:0
                                                      range:NSMakeRange(0, output.length)];
    NSNumber *percent = nil;
    if (match.numberOfRanges > 1) {
        percent = @([[output substringWithRange:[match rangeAtIndex:1]] integerValue]);
    }
    return @{ @"lidClosed": @(ReadClamshellState()),
              @"onBattery": @(onBattery),
              @"batteryPercent": percent ?: [NSNull null] };
}

static BOOL ReadSleepDisabled(void) {
    NSString *output = RunTask(@"/usr/bin/pmset", @[@"-g"])[@"output"];
    for (NSString *line in [output componentsSeparatedByCharactersInSet:NSCharacterSet.newlineCharacterSet]) {
        NSArray *parts = [line componentsSeparatedByCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
        NSMutableArray *fields = [NSMutableArray array];
        for (NSString *part in parts) if (part.length) [fields addObject:part];
        if (fields.count >= 2 && [fields[0] isEqual:@"SleepDisabled"]) {
            return [fields[1] integerValue] == 1;
        }
    }
    return NO;
}

static BOOL SetSleepDisabled(BOOL disabled, NSError **error) {
    NSDictionary *result = RunTask(@"/usr/bin/pmset", @[@"-a", @"disablesleep", disabled ? @"1" : @"0"]);
    if ([result[@"status"] intValue] == 0) return YES;
    if (error) {
        *error = [NSError errorWithDomain:@"com.maker-or.omni.sleeplessd" code:1
                                 userInfo:@{NSLocalizedDescriptionKey:
                                                [result[@"output"] length] ? result[@"output"] : @"pmset failed."}];
    }
    return NO;
}

static NSInteger Clamp(NSInteger value, NSInteger minimum, NSInteger maximum) {
    return MAX(minimum, MIN(maximum, value));
}

@interface PowerLeaseManager : NSObject
@property(nonatomic) SleeplessLease *lease;
@property(nonatomic) NSUInteger generation;
- (NSDictionary *)arm:(NSDictionary *)payload error:(NSError **)error;
- (NSDictionary *)heartbeat:(NSDictionary *)payload error:(NSError **)error;
- (NSDictionary *)disarmAndSleepIfClosed:(BOOL)sleep;
- (NSDictionary *)state;
- (void)clientDisconnected;
- (void)watchdogTick;
@end

@implementation PowerLeaseManager

- (instancetype)init {
    if ((self = [super init])) [self recoverStaleLease];
    return self;
}

- (NSDictionary *)arm:(NSDictionary *)payload error:(NSError **)error {
    @synchronized(self) {
        NSDictionary *power = PowerSnapshot();
        NSInteger floor = Clamp([payload[@"batteryFloor"] integerValue] ?: 20, 10, 80);
        NSInteger duration = Clamp([payload[@"maxDurationSec"] integerValue] ?: 14400, 900, 43200);
        BOOL acOnly = payload[@"acOnly"] ? [payload[@"acOnly"] boolValue] : YES;
        NSInteger activeTasks = MAX(1, [payload[@"activeTasks"] integerValue]);
        NSNumber *percent = power[@"batteryPercent"] == NSNull.null ? nil : power[@"batteryPercent"];

        NSString *reason = nil;
        if (acOnly && [power[@"onBattery"] boolValue])
            reason = @"Connect a power adapter before enabling lid-closed execution.";
        else if ([power[@"onBattery"] boolValue] && percent && percent.integerValue <= floor)
            reason = @"Battery is below the configured safety floor.";
        else if (NSProcessInfo.processInfo.thermalState == NSProcessInfoThermalStateCritical)
            reason = @"The Mac is under critical thermal pressure.";
        if (reason) {
            if (error) *error = [NSError errorWithDomain:@"com.maker-or.omni.sleeplessd" code:2
                                                 userInfo:@{NSLocalizedDescriptionKey: reason}];
            return nil;
        }

        if (self.lease) {
            self.lease.lastHeartbeat = [NSDate date];
            self.lease.activeTasks = activeTasks;
            return [self responseWithPower:power];
        }

        BOOL baseline = ReadSleepDisabled();
        NSData *recovery = [NSJSONSerialization dataWithJSONObject:@{ @"baselineSleepDisabled": @(baseline) }
                                                            options:0 error:error];
        if (!recovery || ![recovery writeToFile:kRecoveryPath options:NSDataWritingAtomic error:error]) return nil;
        chmod(kRecoveryPath.fileSystemRepresentation, 0600);
        if (!baseline && !SetSleepDisabled(YES, error)) {
            [[NSFileManager defaultManager] removeItemAtPath:kRecoveryPath error:nil];
            return nil;
        }

        self.generation += 1;
        SleeplessLease *lease = [[SleeplessLease alloc] init];
        lease.baselineSleepDisabled = baseline;
        lease.armedAt = [NSDate date];
        lease.lastHeartbeat = lease.armedAt;
        lease.activeTasks = activeTasks;
        lease.batteryFloor = floor;
        lease.maxDuration = duration;
        lease.acOnly = acOnly;
        lease.generation = self.generation;
        self.lease = lease;
        return [self responseWithPower:power];
    }
}

- (NSDictionary *)heartbeat:(NSDictionary *)payload error:(NSError **)error {
    @synchronized(self) {
        if (!self.lease) {
            if (error) *error = [NSError errorWithDomain:@"com.maker-or.omni.sleeplessd" code:3
                                                 userInfo:@{NSLocalizedDescriptionKey: @"No active Sleepless lease."}];
            return nil;
        }
        self.lease.lastHeartbeat = [NSDate date];
        self.lease.activeTasks = MAX(0, [payload[@"activeTasks"] integerValue]);
        return [self responseWithPower:PowerSnapshot()];
    }
}

- (NSDictionary *)disarmAndSleepIfClosed:(BOOL)sleep {
    @synchronized(self) {
        NSDictionary *power = PowerSnapshot();
        [self disarmLocked:sleep power:power];
        return [self responseWithPower:power];
    }
}

- (NSDictionary *)state {
    @synchronized(self) { return [self responseWithPower:PowerSnapshot()]; }
}

- (void)clientDisconnected {
    @synchronized(self) {
        if (self.lease) [self disarmLocked:YES power:PowerSnapshot()];
    }
}

- (void)watchdogTick {
    @synchronized(self) {
        SleeplessLease *lease = self.lease;
        if (!lease) return;
        NSDate *now = [NSDate date];
        NSDictionary *power = PowerSnapshot();
        NSNumber *percent = power[@"batteryPercent"] == NSNull.null ? nil : power[@"batteryPercent"];
        BOOL expiredHeartbeat = [now timeIntervalSinceDate:lease.lastHeartbeat] > kHeartbeatTimeout;
        BOOL expiredDuration = [now timeIntervalSinceDate:lease.armedAt] > lease.maxDuration;
        BOOL unsafeBattery = [power[@"onBattery"] boolValue] &&
            (lease.acOnly || (percent && percent.integerValue <= lease.batteryFloor));
        BOOL unsafeThermal = NSProcessInfo.processInfo.thermalState == NSProcessInfoThermalStateCritical;
        if (expiredHeartbeat || expiredDuration || unsafeBattery || unsafeThermal)
            [self disarmLocked:YES power:power];
    }
}

- (NSDictionary *)responseWithPower:(NSDictionary *)power {
    NSMutableDictionary *response = [@{ @"ok": @YES,
                                        @"armed": @(self.lease != nil),
                                        @"lidClosed": power[@"lidClosed"],
                                        @"onBattery": power[@"onBattery"] } mutableCopy];
    if (power[@"batteryPercent"] != NSNull.null) response[@"batteryPercent"] = power[@"batteryPercent"];
    if (self.lease) response[@"armedAt"] = @([self.lease.armedAt timeIntervalSince1970] * 1000.0);
    return response;
}

- (void)disarmLocked:(BOOL)sleep power:(NSDictionary *)power {
    SleeplessLease *lease = self.lease;
    if (!lease) return;
    self.lease = nil;
    self.generation += 1;
    if (!lease.baselineSleepDisabled) SetSleepDisabled(NO, nil);
    [[NSFileManager defaultManager] removeItemAtPath:kRecoveryPath error:nil];
    if (!sleep || ![power[@"lidClosed"] boolValue] || lease.baselineSleepDisabled) return;

    NSUInteger expectedGeneration = self.generation;
    __weak PowerLeaseManager *weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC),
                   dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
        PowerLeaseManager *strongSelf = weakSelf;
        if (!strongSelf) return;
        @synchronized(strongSelf) {
            if (strongSelf.lease || strongSelf.generation != expectedGeneration || !ReadClamshellState()) return;
            RunTask(@"/usr/bin/pmset", @[@"sleepnow"]);
        }
    });
}

- (void)recoverStaleLease {
    NSData *data = [NSData dataWithContentsOfFile:kRecoveryPath];
    if (!data) return;
    NSDictionary *state = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    if ([state[@"baselineSleepDisabled"] isKindOfClass:NSNumber.class])
        SetSleepDisabled([state[@"baselineSleepDisabled"] boolValue], nil);
    [[NSFileManager defaultManager] removeItemAtPath:kRecoveryPath error:nil];
}

@end

static NSString *AppBundleRoot(void) {
    NSString *path = NSProcessInfo.processInfo.arguments.firstObject.stringByResolvingSymlinksInPath;
    NSRange range = [path rangeOfString:@".app/Contents/"];
    if (range.location != NSNotFound)
        return [[path substringToIndex:range.location] stringByAppendingString:@".app"];
    NSDictionary *config = [NSDictionary dictionaryWithContentsOfFile:kInstalledConfig];
    return [config[@"appRoot"] isKindOfClass:NSString.class] ? config[@"appRoot"] : nil;
}

static NSString *TeamIdentifier(SecCodeRef code) {
    CFDictionaryRef info = NULL;
    if (SecCodeCopySigningInformation(code, kSecCSSigningInformation, &info) != errSecSuccess) return nil;
    NSString *team = [(__bridge NSDictionary *)info objectForKey:(__bridge NSString *)kSecCodeInfoTeamIdentifier];
    NSString *copy = [team copy];
    CFRelease(info);
    return copy;
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

static BOOL ValidateClient(int fd) {
    pid_t pid = 0;
    socklen_t size = sizeof(pid);
    if (getsockopt(fd, SOL_LOCAL, LOCAL_PEERPID, &pid, &size) != 0) return NO;

    uid_t peerUID = 0;
    gid_t peerGID = 0;
    if (getpeereid(fd, &peerUID, &peerGID) != 0) return NO;
    struct stat console = {0};
    if (stat("/dev/console", &console) != 0 || console.st_uid == 0 || peerUID != console.st_uid)
        return NO;

    char pathBuffer[PROC_PIDPATHINFO_MAXSIZE] = {0};
    if (proc_pidpath(pid, pathBuffer, sizeof(pathBuffer)) <= 0) return NO;
    NSString *peerPath = [NSString stringWithUTF8String:pathBuffer].stringByResolvingSymlinksInPath;
    NSString *root = AppBundleRoot().stringByResolvingSymlinksInPath;
    NSString *expectedPath = root ? ExpectedClientPath(root) : nil;
    if (!expectedPath || ![peerPath isEqualToString:expectedPath]) return NO;

    SecCodeRef ownCode = NULL;
    SecCodeRef peerCode = NULL;
    if (SecCodeCopySelf(kSecCSDefaultFlags, &ownCode) != errSecSuccess) return NO;
    NSDictionary *attributes = @{ (__bridge NSString *)kSecGuestAttributePid: @(pid) };
    OSStatus peerStatus = SecCodeCopyGuestWithAttributes(NULL, (__bridge CFDictionaryRef)attributes,
                                                         kSecCSDefaultFlags, &peerCode);
    BOOL valid = peerStatus == errSecSuccess && peerCode &&
        SecCodeCheckValidity(peerCode, kSecCSDefaultFlags, NULL) == errSecSuccess;
    NSString *ownTeam = valid ? TeamIdentifier(ownCode) : nil;
    NSString *peerTeam = valid ? TeamIdentifier(peerCode) : nil;
    if (peerCode) CFRelease(peerCode);
    CFRelease(ownCode);
    if (!valid) return NO;
    if (ownTeam.length || peerTeam.length) return [ownTeam isEqualToString:peerTeam];
    return YES;
}

static int MakeServerSocket(void) {
    unlink(kSocketPath);
    int fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) return -1;
    struct sockaddr_un address = {0};
    address.sun_family = AF_UNIX;
    strlcpy(address.sun_path, kSocketPath, sizeof(address.sun_path));
    if (bind(fd, (struct sockaddr *)&address, SUN_LEN(&address)) != 0 || listen(fd, 4) != 0) {
        close(fd);
        return -1;
    }
    chmod(kSocketPath, 0660);
    struct group *staff = getgrnam("staff");
    if (staff) chown(kSocketPath, 0, staff->gr_gid);
    return fd;
}

static void WriteResponse(int fd, NSDictionary *response, NSString *requestID) {
    NSMutableDictionary *body = [response mutableCopy];
    if (requestID) body[@"id"] = requestID;
    NSData *json = [NSJSONSerialization dataWithJSONObject:body options:0 error:nil];
    NSMutableData *line = [json mutableCopy];
    uint8_t newline = '\n';
    [line appendBytes:&newline length:1];
    const uint8_t *bytes = line.bytes;
    NSUInteger sent = 0;
    while (sent < line.length) {
        ssize_t count = write(fd, bytes + sent, line.length - sent);
        if (count <= 0) return;
        sent += (NSUInteger)count;
    }
}

static void HandleLine(int fd, NSData *line, PowerLeaseManager *manager) {
    NSDictionary *request = [NSJSONSerialization JSONObjectWithData:line options:0 error:nil];
    if (![request isKindOfClass:NSDictionary.class]) {
        WriteResponse(fd, @{ @"ok": @NO, @"error": @"Invalid JSON request." }, nil);
        return;
    }
    NSString *requestID = [request[@"id"] isKindOfClass:NSString.class] ? request[@"id"] : nil;
    NSString *command = [request[@"command"] isKindOfClass:NSString.class] ? request[@"command"] : @"";
    NSDictionary *payload = [request[@"payload"] isKindOfClass:NSDictionary.class] ? request[@"payload"] : @{};
    NSError *error = nil;
    NSDictionary *response = nil;
    if ([command isEqualToString:@"ARM"]) response = [manager arm:payload error:&error];
    else if ([command isEqualToString:@"HEARTBEAT"]) response = [manager heartbeat:payload error:&error];
    else if ([command isEqualToString:@"DISARM"])
        response = [manager disarmAndSleepIfClosed:[payload[@"triggerSleepIfLidClosed"] boolValue]];
    else if ([command isEqualToString:@"GET_STATE"] || [command isEqualToString:@"STATUS"])
        response = [manager state];
    else error = [NSError errorWithDomain:@"com.maker-or.omni.sleeplessd" code:4
                                  userInfo:@{NSLocalizedDescriptionKey:
                                                 [NSString stringWithFormat:@"Unknown command: %@", command]}];
    if (error) response = @{ @"ok": @NO, @"error": error.localizedDescription };
    WriteResponse(fd, response, requestID);
}

static void HandleClient(int fd, PowerLeaseManager *manager) {
    if (!ValidateClient(fd)) {
        WriteResponse(fd, @{ @"ok": @NO, @"error": @"Client signature validation failed." }, nil);
        close(fd);
        return;
    }
    NSMutableData *line = [NSMutableData data];
    uint8_t buffer[4096];
    for (;;) {
        ssize_t count = read(fd, buffer, sizeof(buffer));
        if (count <= 0) break;
        for (ssize_t index = 0; index < count; index++) {
            if (buffer[index] == '\n') {
                if (line.length) HandleLine(fd, line, manager);
                [line setLength:0];
            } else {
                [line appendBytes:&buffer[index] length:1];
                if (line.length > 65536) { close(fd); [manager clientDisconnected]; return; }
            }
        }
    }
    close(fd);
    [manager clientDisconnected];
}

int main(void) {
    @autoreleasepool {
        PowerLeaseManager *manager = [[PowerLeaseManager alloc] init];
        dispatch_source_t watchdog = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0,
                                                             dispatch_get_global_queue(QOS_CLASS_UTILITY, 0));
        dispatch_source_set_timer(watchdog, dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC),
                                  2 * NSEC_PER_SEC, NSEC_PER_SEC / 5);
        dispatch_source_set_event_handler(watchdog, ^{ [manager watchdogTick]; });
        dispatch_resume(watchdog);

        int server = MakeServerSocket();
        if (server < 0) return 1;
        for (;;) {
            int client = accept(server, NULL, NULL);
            if (client >= 0) HandleClient(client, manager);
        }
    }
}
